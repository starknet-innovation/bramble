/**
 * Relay status reads (issue 299) prove an outcome or prove nothing. A used
 * nonce means an outside execution with it ran; an unused nonce at a block past
 * the deadline means it can no longer run; every other answer, including a
 * failed read, leaves the row signed. Reads are bounded per refresh, throttled
 * per row, and skipped for account types whose nonce view is not verified.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import {
  memoryRelaySignatureLog,
  type RelaySignatureInput,
} from "@bramble/transactions/relay-signatures";
import type { RpcProvider } from "starknet";
import {
  MAX_RELAY_READS_PER_REFRESH,
  RELAY_RECHECK_MS,
  refreshRelaySignatures,
} from "../../../apps/extension/src/background/transactions/relay-status";

const ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const scope = { accountId: `SN_MAIN:${ADDRESS}`, networkId: "SN_MAIN" } as const;
const DEADLINE = 1_800_000_000;
const NOW = (DEADLINE + 10) * 1000;

const input = (overrides: Partial<RelaySignatureInput> = {}): RelaySignatureInput => ({
  accountId: scope.accountId,
  callCount: 1,
  checkable: true,
  executeBefore: DEADLINE,
  messageHash: "0xabc",
  networkId: "SN_MAIN",
  nonce: "0x2a",
  origin: "https://app.example",
  revision: "2",
  ...overrides,
});

type Answer = {
  readonly block?: Error;
  readonly nonce: readonly string[] | Error;
  readonly timestamp?: number;
};

// A provider that answers the nonce view and the latest block, and records
// every call so the tests can see what was asked and at which block.
const provider = (answer: Answer, calls: unknown[] = []): RpcProvider =>
  ({
    callContract: async (call: unknown, block: unknown) => {
      calls.push({ block, call });
      if (answer.nonce instanceof Error) throw answer.nonce;
      return answer.nonce;
    },
    getBlockWithTxHashes: async (block: unknown) => {
      calls.push({ block: "getBlock", requested: block });
      if (answer.block) throw answer.block;
      return { block_number: 77, timestamp: answer.timestamp ?? DEADLINE };
    },
  }) as unknown as RpcProvider;

const refresh = async (
  answer: Answer,
  rows: readonly RelaySignatureInput[] = [input()],
  now = NOW,
  calls: unknown[] = [],
) => {
  const log = memoryRelaySignatureLog(() => 1);
  for (const row of rows) await log.record(row);
  const result = await refreshRelaySignatures(
    { log, rpcProviderFor: () => provider(answer, calls) },
    { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
    now,
  );
  return { calls, log, result };
};

beforeEach(() => resetRpcEndpointCooldownsForTests());

describe("refreshRelaySignatures", () => {
  test("a used nonce marks the row nonce-used and keeps the signed fee", async () => {
    const userFee = { amount: "1000", decimals: 6, token: "USDC" };
    const { calls, result } = await refresh({ nonce: ["0x0"] }, [
      input({ executeBefore: 2e9, userFee }),
    ]);
    expect(result[0]?.status).toBe("nonce-used");
    expect(result[0]?.userFee).toEqual(userFee);
    expect(result[0]?.checkedAt).toBe(NOW);
    // Before the deadline no block is read; the nonce is asked at "latest".
    expect(calls).toEqual([
      {
        block: "latest",
        call: {
          calldata: ["0x2a"],
          contractAddress: ADDRESS,
          entrypoint: "is_valid_outside_execution_nonce",
        },
      },
    ]);
  });

  test("an unused nonce at a block past the deadline marks it expired, read at that block", async () => {
    const { calls, result } = await refresh({ nonce: ["0x1"], timestamp: DEADLINE });
    expect(result[0]?.status).toBe("expired");
    expect(calls[0]).toEqual({ block: "getBlock", requested: "latest" });
    expect((calls[1] as { block: unknown }).block).toBe(77);
  });

  test("the chain's clock, not the device's, decides expiry", async () => {
    const { result } = await refresh({ nonce: ["0x1"], timestamp: DEADLINE - 1 });
    expect(result[0]?.status).toBe("signed");
  });

  test("an unused nonce before the deadline stays signed", async () => {
    const { result } = await refresh({ nonce: ["0x1"] }, [input({ executeBefore: 2e9 })]);
    expect(result[0]?.status).toBe("signed");
  });

  test("a message without a deadline never expires", async () => {
    const { executeBefore: _deadline, ...open } = input();
    const { calls, result } = await refresh({ nonce: ["0x1"] }, [open]);
    expect(result[0]?.status).toBe("signed");
    expect(calls).toHaveLength(1);
  });

  for (const nonce of [["0x2"], [], ["0x0", "0x1"]]) {
    test(`an unexpected answer ${JSON.stringify(nonce)} proves nothing`, async () => {
      const { result } = await refresh({ nonce });
      expect(result[0]?.status).toBe("signed");
    });
  }

  test("a failed read leaves the row signed and stamps the attempt", async () => {
    const { result } = await refresh({ nonce: new Error("Requested entrypoint does not exist") });
    expect(result[0]?.status).toBe("signed");
    expect(result[0]?.checkedAt).toBe(NOW);
  });

  test("an account type without a verified nonce view is never read", async () => {
    const { calls, result } = await refresh({ nonce: ["0x0"] }, [input({ checkable: false })]);
    expect(calls).toEqual([]);
    expect(result[0]?.status).toBe("signed");
  });

  test("a row checked within the recheck window is not read again", async () => {
    const calls: unknown[] = [];
    const { log } = await refresh({ nonce: ["0x1"] }, [input({ executeBefore: 2e9 })], NOW, calls);
    await refreshRelaySignatures(
      { log, rpcProviderFor: () => provider({ nonce: ["0x0"] }, calls) },
      { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
      NOW + RELAY_RECHECK_MS - 1,
    );
    expect(calls).toHaveLength(1);
    const later = await refreshRelaySignatures(
      { log, rpcProviderFor: () => provider({ nonce: ["0x0"] }, calls) },
      { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
      NOW + RELAY_RECHECK_MS,
    );
    expect(later[0]?.status).toBe("nonce-used");
  });

  test(`reads at most ${MAX_RELAY_READS_PER_REFRESH} rows per refresh, settled rows never`, async () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      input({ executeBefore: 2e9, messageHash: `0x${(index + 1).toString(16)}` }),
    );
    const calls: unknown[] = [];
    const { log } = await refresh({ nonce: ["0x0"] }, rows, NOW, calls);
    expect(calls).toHaveLength(MAX_RELAY_READS_PER_REFRESH);
    const after = await refreshRelaySignatures(
      { log, rpcProviderFor: () => provider({ nonce: ["0x0"] }, calls) },
      { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
      NOW,
    );
    expect(calls).toHaveLength(6);
    expect(after.every((row) => row.status === "nonce-used")).toBe(true);
  });

  test("rows never read go first, then the least recently read, so none is starved", async () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      input({ executeBefore: 2e9, messageHash: `0x${(index + 1).toString(16)}` }),
    );
    const { log } = await refresh({ nonce: ["0x1"] }, rows, NOW);
    let checked = (await log.list(scope)).filter((row) => row.checkedAt !== undefined);
    expect(checked).toHaveLength(MAX_RELAY_READS_PER_REFRESH);
    // Past the throttle every row is due again; the two never read go first.
    const second = await refreshRelaySignatures(
      { log, rpcProviderFor: () => provider({ nonce: ["0x1"] }) },
      { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
      NOW + RELAY_RECHECK_MS,
    );
    checked = second.filter((row) => row.checkedAt !== undefined);
    expect(checked).toHaveLength(6);
    expect(second.filter((row) => row.checkedAt === NOW + RELAY_RECHECK_MS)).toHaveLength(
      MAX_RELAY_READS_PER_REFRESH,
    );
    // The next refresh reads the rows left oldest, not the newest again.
    const stale = second
      .filter((row) => row.checkedAt === NOW)
      .map((row) => row.messageHash)
      .sort();
    const third = await refreshRelaySignatures(
      { log, rpcProviderFor: () => provider({ nonce: ["0x1"] }) },
      { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
      NOW + 2 * RELAY_RECHECK_MS,
    );
    expect(
      third
        .filter((row) => row.checkedAt === NOW + 2 * RELAY_RECHECK_MS)
        .map((row) => row.messageHash)
        .sort(),
    ).toEqual(expect.arrayContaining(stale));
  });

  test("one refresh reads the latest block once, and every expiring row at that block", async () => {
    const rows = ["0x1", "0x2", "0x3"].map((messageHash) => input({ messageHash }));
    const { calls, result } = await refresh({ nonce: ["0x1"], timestamp: DEADLINE }, rows);
    expect(calls.filter((call) => (call as { block: unknown }).block === "getBlock")).toHaveLength(
      1,
    );
    expect(calls.filter((call) => (call as { block: unknown }).block === 77)).toHaveLength(3);
    expect(result.every((row) => row.status === "expired")).toBe(true);
  });

  test("the rows' nonces are read in parallel, not one after another", async () => {
    const rows = ["0x1", "0x2", "0x3"].map((messageHash) =>
      input({ executeBefore: 2e9, messageHash }),
    );
    // Each read answers only once all three have started, so reading them in
    // sequence would never finish.
    let started = 0;
    let release: () => void = () => undefined;
    const allStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated = {
      callContract: async () => {
        started += 1;
        if (started === rows.length) release();
        await allStarted;
        return ["0x0"];
      },
    } as unknown as RpcProvider;
    const log = memoryRelaySignatureLog(() => 1);
    for (const row of rows) await log.record(row);
    const result = await Promise.race([
      refreshRelaySignatures(
        { log, rpcProviderFor: () => gated },
        { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
        NOW,
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
    ]);
    expect(result?.every((row) => row.status === "nonce-used")).toBe(true);
  });

  test("a block without a number leaves expiry undecided but still proves a used nonce", async () => {
    const pending = {
      callContract: async (_call: unknown, block: unknown) => (block === "latest" ? ["0x0"] : []),
      getBlockWithTxHashes: async () => ({ timestamp: DEADLINE }),
    } as unknown as RpcProvider;
    const log = memoryRelaySignatureLog(() => 1);
    await log.record(input());
    const result = await refreshRelaySignatures(
      { log, rpcProviderFor: () => pending },
      { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
      NOW,
    );
    expect(result[0]?.status).toBe("nonce-used");
  });

  test("a failed block read leaves the row signed", async () => {
    // The failing node is benched for the rest of the refresh, so nothing is proven.
    const { result } = await refresh({ block: new Error("block unavailable"), nonce: ["0x1"] });
    expect(result[0]?.status).toBe("signed");
    expect(result[0]?.checkedAt).toBe(NOW);
  });

  test("once the block is read, its clock expires a row the device clock has not reached", async () => {
    // The first row is past its deadline by the device clock, so the block is
    // read; its timestamp is also past the second row's later deadline.
    const rows = [
      input({ messageHash: "0x1" }),
      input({ executeBefore: DEADLINE + 20, messageHash: "0x2" }),
    ];
    const { result } = await refresh({ nonce: ["0x1"], timestamp: DEADLINE + 30 }, rows);
    expect(result.map((row) => row.status)).toEqual(["expired", "expired"]);
  });

  test("an unreadable log yields no rows instead of throwing", async () => {
    const failing = {
      ...memoryRelaySignatureLog(),
      list: async () => {
        throw new Error("storage unavailable");
      },
    };
    await expect(
      refreshRelaySignatures(
        { log: failing },
        { address: ADDRESS, rpcUrls: ["https://rpc.example"], scope },
        NOW,
      ),
    ).resolves.toEqual([]);
  });
});
