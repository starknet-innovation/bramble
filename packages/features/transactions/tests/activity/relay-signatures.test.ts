/**
 * The signed-for-relay log (issue 299) keeps a signature apart from the
 * transaction log, scopes it to one account on one network, refreshes the same
 * message instead of duplicating it, stays bounded, and only lets chain
 * evidence move a status forward: `nonce-used` is final, and `expired` yields
 * only to `nonce-used`.
 */
import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "@bramble/store/kv";
import {
  createRelaySignatureLog,
  isRelaySignature,
  MAX_RELAY_SIGNATURES,
  memoryRelaySignatureLog,
  type RelaySignatureInput,
  type RelaySignatureLog,
} from "@bramble/transactions/relay-signatures";

const ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const OTHER = "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const scope = { accountId: `SN_MAIN:${ADDRESS}`, networkId: "SN_MAIN" } as const;
const otherScope = { accountId: `SN_MAIN:${OTHER}`, networkId: "SN_MAIN" } as const;

const input = (overrides: Partial<RelaySignatureInput> = {}): RelaySignatureInput => ({
  accountId: scope.accountId,
  callCount: 2,
  checkable: true,
  executeBefore: 1_900_000_000,
  messageHash: "0xabc",
  networkId: "SN_MAIN",
  nonce: "0x2a",
  origin: "https://app.example",
  revision: "2",
  ...overrides,
});

const logs: ReadonlyArray<readonly [string, (now: () => number) => RelaySignatureLog]> = [
  ["persistent", (now) => createRelaySignatureLog({ now, store: createMemoryStore() })],
  ["memory", (now) => memoryRelaySignatureLog(now)],
];

for (const [name, make] of logs) {
  describe(`${name} relay-signature log`, () => {
    test("records a signature as signed, scoped to its account and network", async () => {
      const log = make(() => 5_000);
      await log.record(input());
      await log.record(input({ accountId: otherScope.accountId, messageHash: "0xdef" }));
      expect(await log.list(scope)).toEqual([{ ...input(), signedAt: 5_000, status: "signed" }]);
      expect((await log.list(otherScope)).map((entry) => entry.messageHash)).toEqual(["0xdef"]);
    });

    test("the same message signed again replaces its row instead of adding one", async () => {
      let now = 1;
      const log = make(() => now);
      await log.record(input());
      now = 2;
      await log.record(input({ messageHash: "0x0abc" }));
      expect((await log.list(scope)).map((entry) => entry.signedAt)).toEqual([2]);
    });

    for (const status of ["nonce-used", "expired"] as const) {
      test(`signing a ${status} message again keeps its chain evidence`, async () => {
        let now = 1;
        const log = make(() => now);
        await log.record(input());
        await log.updateStatuses(scope, new Map([["0xabc", status]]), 50);
        now = 60;
        await log.record(input());
        const rows = await log.list(scope);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.status).toBe(status);
        expect(rows[0]?.checkedAt).toBe(50);
        expect(rows[0]?.signedAt).toBe(60);
      });
    }

    test("drops a record that would not validate", async () => {
      const log = make(() => 1);
      await log.record(input({ nonce: "not a felt" }));
      await log.record(input({ callCount: -1 }));
      await log.record(input({ userFee: { amount: "0", decimals: 6, token: "USDC" } }));
      expect(await log.list(scope)).toEqual([]);
    });

    test("keeps a signed fee on the row", async () => {
      const log = make(() => 5_000);
      const userFee = { amount: "1000", decimals: 6, token: "USDC" };
      await log.record(input({ userFee }));
      expect(await log.list(scope)).toEqual([
        { ...input({ userFee }), signedAt: 5_000, status: "signed" },
      ]);
    });

    test("cuts a long origin to its registrable end", async () => {
      const log = make(() => 1);
      await log.record(input({ origin: `https://${"a".repeat(100)}.example.com` }));
      const [entry] = await log.list(scope);
      expect(entry?.origin.startsWith("…")).toBe(true);
      expect(entry?.origin.endsWith("example.com")).toBe(true);
    });

    test(`keeps the newest ${MAX_RELAY_SIGNATURES} records`, async () => {
      let now = 0;
      const log = make(() => now);
      for (let index = 1; index <= MAX_RELAY_SIGNATURES + 3; index += 1) {
        now = index;
        await log.record(input({ messageHash: `0x${index.toString(16)}` }));
      }
      const kept = await log.list(scope);
      expect(kept).toHaveLength(MAX_RELAY_SIGNATURES);
      expect(kept[0]?.signedAt).toBe(MAX_RELAY_SIGNATURES + 3);
      expect(kept.at(-1)?.signedAt).toBe(4);
    });

    test("a nonce-used read is final and an expiry yields only to it", async () => {
      const log = make(() => 1);
      await log.record(input({ messageHash: "0x1" }));
      await log.record(input({ messageHash: "0x2" }));
      await log.updateStatuses(
        scope,
        new Map([
          ["0x1", "nonce-used"],
          ["0x2", "expired"],
        ]),
        10,
      );
      const after = await log.updateStatuses(
        scope,
        new Map([
          ["0x1", "expired"],
          ["0x2", "nonce-used"],
        ]),
        20,
      );
      expect(after.map((entry) => [entry.messageHash, entry.status, entry.checkedAt])).toEqual([
        ["0x1", "nonce-used", 20],
        ["0x2", "nonce-used", 20],
      ]);
    });

    test("a signed read changes only the check time, and other scopes are untouched", async () => {
      const log = make(() => 1);
      await log.record(input());
      await log.record(input({ accountId: otherScope.accountId }));
      await log.updateStatuses(scope, new Map([["0xabc", "signed"]]), 30);
      await log.updateStatuses(scope, new Map([["0x0abc", "expired"]]), 40);
      const [entry] = await log.list(scope);
      expect(entry?.status).toBe("expired");
      expect(entry?.checkedAt).toBe(40);
      const [other] = await log.list(otherScope);
      expect(other?.status).toBe("signed");
      expect(other?.checkedAt).toBeUndefined();
    });
  });
}

describe("persistent relay-signature storage", () => {
  test("ignores stored rows that do not validate", async () => {
    const store = createMemoryStore();
    const log = createRelaySignatureLog({ now: () => 1, store });
    await log.record(input());
    const [valid] = (await store.get("bramble:relay-signatures")) as Record<string, string>[];
    await store.set("bramble:relay-signatures", [valid ?? {}, { ...valid, status: "done" }, 7]);
    expect(await log.list(scope)).toHaveLength(1);
    expect(isRelaySignature({ ...valid, extra: true })).toBe(false);
  });
});
