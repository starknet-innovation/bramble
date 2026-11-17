/**
 * Curated tokens the account holds are tracked without a manual scan
 * (mc-wallet issue 663): a received USDC.e shows on the next balance read, a
 * shielded curated token is tracked from the private read, and nothing outside
 * the curated registry, nothing the user removed, and nothing already hidden
 * changes.
 */
import { describe, expect, test } from "bun:test";
import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import { createPreferencesStore, type TokenConfig } from "@bramble/settings/preferences";
import { getTokenBalances, type TokenBalance } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import { sameFelt, USDC_TOKEN_ADDRESS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import {
  curatedProbe,
  privateReadTokens,
  trackHeldCuratedTokens,
  trackPrivatelyHeldTokens,
  untrackedCuratedTokens,
} from "../../../apps/extension/src/background/portfolio/held-tokens";
import { harnessExtensionSender, makeMultisigHarness } from "../../support/multisig-harness";

const curated = (symbol: string): TokenConfig => {
  const token = knownTokensForNetwork("SN_MAIN").find((entry) => entry.symbol === symbol);
  if (!token) throw new Error(`no curated ${symbol}`);
  return token;
};
const USDC_E = curated("USDC.e");
const WBTC = curated("WBTC");
const SPAM = "0x0badbadbad";

type BalancesResponse = { readonly balances: readonly TokenBalance[]; readonly ok: true };

const setup = async () => {
  const amounts = new Map<string, bigint>();
  const called = new Set<string>();
  let now = 1_000_000;
  const harness = await makeMultisigHarness({
    getTokenBalances: (input) =>
      getTokenBalances(
        input,
        () =>
          ({
            callContract: async (call: { readonly contractAddress: string }) => {
              called.add(BigInt(call.contractAddress).toString(16));
              const amount = [...amounts].find(([address]) =>
                sameFelt(address, call.contractAddress),
              )?.[1];
              return [`0x${(amount ?? 0n).toString(16)}`, "0x0"];
            },
          }) as unknown as RpcProvider,
      ),
    now: () => now,
  });
  const read = async (): Promise<BalancesResponse> => {
    now += 120_000;
    return (await harness.handler(
      { refresh: true, type: "wallet.getBalances" },
      harnessExtensionSender,
    )) as BalancesResponse;
  };
  const trackedAt = async (address: string) =>
    (await harness.preferencesStore.read()).tokens.find(
      (token) => token.networkId === "SN_MAIN" && sameFelt(token.address, address),
    );
  return { amounts, called, harness, read, trackedAt };
};

describe("public balance reads track held curated tokens", () => {
  test("a held curated token is tracked and shown on the same read", async () => {
    const { amounts, read, trackedAt } = await setup();
    amounts.set(USDC_E.address, 2_500_000n);
    const response = await read();
    expect(response.ok).toBe(true);
    expect(
      response.balances.find((balance) => sameFelt(balance.address, USDC_E.address))?.balance,
    ).toBe("2500000");
    expect(await trackedAt(USDC_E.address)).toMatchObject({ decimals: 6, symbol: "USDC.e" });
  });

  test("a curated token with no balance is read but not tracked", async () => {
    const { read, trackedAt } = await setup();
    const response = await read();
    expect(response.balances.some((balance) => sameFelt(balance.address, WBTC.address))).toBe(
      false,
    );
    expect(await trackedAt(WBTC.address)).toBeUndefined();
  });

  test("the RPC is asked about the same tokens whatever the account holds", async () => {
    const empty = await setup();
    await empty.read();
    const holding = await setup();
    holding.amounts.set(WBTC.address, 1n);
    await holding.read();
    await holding.read();
    expect([...holding.called].sort()).toEqual([...empty.called].sort());
    for (const token of knownTokensForNetwork("SN_MAIN")) {
      expect(empty.called.has(BigInt(token.address).toString(16))).toBe(true);
    }
  });

  test("a token outside the curated registry is never read or tracked", async () => {
    const { amounts, called, read, trackedAt } = await setup();
    amounts.set(SPAM, 10n ** 24n);
    await read();
    expect(called.has(BigInt(SPAM).toString(16))).toBe(false);
    expect(await trackedAt(SPAM)).toBeUndefined();
  });

  test("a curated token the user removed is not tracked again", async () => {
    const { amounts, harness, read, trackedAt } = await setup();
    amounts.set(USDC_TOKEN_ADDRESS, 1_000_000n);
    const usdc = await trackedAt(USDC_TOKEN_ADDRESS);
    await expect(
      harness.handler({ tokenId: usdc?.id, type: "wallet.removeToken" }, harnessExtensionSender),
    ).resolves.toMatchObject({ ok: true });
    const response = await read();
    expect(await trackedAt(USDC_TOKEN_ADDRESS)).toBeUndefined();
    expect(response.balances.some((balance) => sameFelt(balance.address, USDC_TOKEN_ADDRESS))).toBe(
      false,
    );
  });

  test("a hidden curated token stays tracked and hidden", async () => {
    const { amounts, harness, read, trackedAt } = await setup();
    const usdc = await trackedAt(USDC_TOKEN_ADDRESS);
    await harness.handler(
      { hidden: true, tokenId: usdc?.id, type: "wallet.setTokenHidden" },
      harnessExtensionSender,
    );
    amounts.set(USDC_TOKEN_ADDRESS, 1_000_000n);
    await read();
    const preferences = await harness.preferencesStore.read();
    expect(preferences.hiddenTokens).toContain(usdc?.id ?? "");
    expect(
      preferences.tokens.filter((token) => sameFelt(token.address, USDC_TOKEN_ADDRESS)),
    ).toHaveLength(1);
  });
});

describe("private balance reads track privately held curated tokens", () => {
  const store = () => createPreferencesStore({ store: createMemoryStore() });

  test("the private read asks for the tracked tokens, then the curated ones, within the bound", async () => {
    const preferences = await store().read();
    const tracked = preferences.tokens.filter((token) => token.networkId === "SN_MAIN");
    const extra = untrackedCuratedTokens(preferences, "SN_MAIN");
    expect(extra.map((token) => token.symbol)).toEqual([
      "USDC.e",
      "USDT",
      "DAI",
      "WBTC",
      "WSTETH",
      "XSTRK",
      "XWBTC",
    ]);
    expect(privateReadTokens(tracked, extra, 64)).toEqual(
      [...tracked, ...extra].map((token) => token.address),
    );
    expect(privateReadTokens(tracked, extra, tracked.length + 1)).toHaveLength(tracked.length + 1);
    expect(privateReadTokens(tracked, extra, 1)).toHaveLength(tracked.length);
  });

  test("a curated token with a private balance is tracked; a zero or uncurated one is not", async () => {
    const preferencesStore = store();
    const preferences = await preferencesStore.read();
    const tracked = preferences.tokens.filter((token) => token.networkId === "SN_MAIN");
    const after = await trackPrivatelyHeldTokens(
      preferencesStore,
      "SN_MAIN",
      tracked,
      untrackedCuratedTokens(preferences, "SN_MAIN"),
      [
        { balance: "0x5", token: WBTC.address },
        { balance: "0x0", token: USDC_E.address },
        { balance: "0x9", token: SPAM },
      ],
    );
    expect(after.map((token) => token.symbol)).toEqual([
      ...tracked.map((token) => token.symbol),
      "WBTC",
    ]);
    const stored = (await preferencesStore.read()).tokens.map((token) => token.symbol);
    expect(stored).toContain("WBTC");
    expect(stored).not.toContain("USDC.e");
  });

  test("nothing held writes nothing", async () => {
    let writes = 0;
    const preferencesStore = store();
    const counting = {
      read: preferencesStore.read,
      upsertToken: async (...args: Parameters<typeof preferencesStore.upsertToken>) => {
        writes += 1;
        return preferencesStore.upsertToken(...args);
      },
    };
    await expect(trackHeldCuratedTokens(counting, "SN_MAIN", [])).resolves.toEqual([]);
    await expect(trackHeldCuratedTokens(counting, "SN_MAIN", [SPAM])).resolves.toEqual([]);
    expect(writes).toBe(0);
  });

  test("a store refusal skips the token instead of failing the read", async () => {
    const preferencesStore = store();
    const refusing = {
      read: preferencesStore.read,
      upsertToken: async () => {
        throw new Error("cap reached");
      },
    };
    await expect(trackHeldCuratedTokens(refusing, "SN_MAIN", [WBTC.address])).resolves.toEqual([]);
  });
});

describe("curated probe trigger", () => {
  test("probes on a new scope, then every ten minutes or on a forced refresh after a minute", () => {
    const owner = {};
    const ran = (scope: string, now: number, forced = false) => {
      const probe = curatedProbe(owner, scope, now, forced);
      if (probe.due) probe.ran();
      return probe.due;
    };
    expect(ran("1:SN_MAIN:0xa", 0)).toBe(true);
    expect(ran("1:SN_MAIN:0xa", 30_000)).toBe(false);
    expect(ran("1:SN_MAIN:0xa", 30_000, true)).toBe(false);
    expect(ran("1:SN_MAIN:0xa", 61_000, true)).toBe(true);
    expect(ran("1:SN_MAIN:0xa", 200_000)).toBe(false);
    expect(ran("1:SN_MAIN:0xa", 61_000 + 600_000)).toBe(true);
    // An account switch or a new unlock is a new scope.
    expect(ran("1:SN_MAIN:0xb", 61_001)).toBe(true);
    expect(ran("2:SN_MAIN:0xa", 61_002)).toBe(true);
  });

  test("a probe that did not complete is retried on the next read", () => {
    const owner = {};
    expect(curatedProbe(owner, "s", 0, false).due).toBe(true);
    expect(curatedProbe(owner, "s", 1, false).due).toBe(true);
  });

  test("an ambient read within ten minutes of a probe does not ask about curated tokens", async () => {
    const { called, harness } = await setup();
    await harness.handler({ refresh: true, type: "wallet.getBalances" }, harnessExtensionSender);
    called.clear();
    await harness.handler({ refresh: true, type: "wallet.getBalances" }, harnessExtensionSender);
    expect(called.has(BigInt(WBTC.address).toString(16))).toBe(false);
  });
});
