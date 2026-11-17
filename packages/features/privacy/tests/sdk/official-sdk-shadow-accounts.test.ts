/**
 * Listing a scope's shadow accounts (#443, PR 5): the partial commitment comes
 * from the SDK, the addresses and deployment state from the configured
 * anonymizer's `get_shadow_accounts`, in windows the view accepts. Undeployed
 * nonces are listed too. A malformed answer, an unreachable node, a missing
 * anonymizer, or a nonce outside the view's u64 range fails closed.
 */
import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import { strk20ShadowAccountReads } from "../../src/sdk/official-sdk-shadow-accounts";
import { officialBuilder, STRK20_SDK_CONTEXT, sdkRuntime } from "../support/official-sdk";

type Call = {
  readonly calldata: readonly string[];
  readonly contractAddress: string;
  readonly entrypoint: string;
};

const anonymizerAnswering =
  (calls: Call[], deployedNonces: ReadonlySet<bigint>, corrupt = false) =>
  () =>
    ({
      callContract: async (call: Call) => {
        calls.push(call);
        const start = BigInt(call.calldata[1] ?? "0");
        const end = BigInt(call.calldata[2] ?? "0");
        const entries: string[] = [];
        for (let nonce = start; nonce < end; nonce += 1n) {
          entries.push(
            `0x${nonce.toString(16)}`,
            `0x${(0xa000n + nonce).toString(16)}`,
            deployedNonces.has(nonce) ? "0x1" : "0x0",
          );
        }
        return [`0x${(corrupt ? end - start + 1n : end - start).toString(16)}`, ...entries];
      },
    }) as unknown as RpcProvider;

const reads = (provider: () => RpcProvider) =>
  strk20ShadowAccountReads({
    pauseForServiceRetry: async () => undefined,
    providerFor: provider,
    sdk: sdkRuntime(() => ({
      build: () => officialBuilder(),
      discoverNotes: async () => ({ notes: {} as never }),
      executeWithInvocation: async () => ({}),
    })),
  });

describe("shadow account listing", () => {
  test("lists deployed and undeployed nonces through the anonymizer view, in windows", async () => {
    const calls: Call[] = [];
    const { shadowAccounts } = reads(anonymizerAnswering(calls, new Set([1n])));
    const infos = await shadowAccounts?.({
      ...STRK20_SDK_CONTEXT,
      dappName: "scope",
      nonces: [0n, 1n, 2n, 9n, 1n],
    });
    expect(infos).toEqual([
      { address: "0xa000", deployed: false, nonce: "0x0" },
      { address: "0xa001", deployed: true, nonce: "0x1" },
      { address: "0xa002", deployed: false, nonce: "0x2" },
      { address: "0xa009", deployed: false, nonce: "0x9" },
    ]);
    // The configured anonymizer, the SDK's partial commitment, two windows.
    expect(calls).toEqual([
      {
        calldata: ["0x456", "0x0", "0x3", "0x0"],
        contractAddress: "0x789",
        entrypoint: "get_shadow_accounts",
      },
      {
        calldata: ["0x456", "0x9", "0xa", "0x0"],
        contractAddress: "0x789",
        entrypoint: "get_shadow_accounts",
      },
    ]);
  });

  test("the last listable nonce, 2^64 − 2, ends its window at the u64 maximum", async () => {
    const calls: Call[] = [];
    const { shadowAccounts } = reads(anonymizerAnswering(calls, new Set()));
    const last = (1n << 64n) - 2n;
    await shadowAccounts?.({ ...STRK20_SDK_CONTEXT, dappName: "scope", nonces: [last] });
    expect(calls[0]?.calldata.slice(1, 3)).toEqual([
      `0x${last.toString(16)}`,
      `0x${((1n << 64n) - 1n).toString(16)}`,
    ]);
  });

  test("fails closed on a malformed answer, a missing anonymizer, or an out-of-range nonce", async () => {
    const calls: Call[] = [];
    const corrupt = reads(anonymizerAnswering(calls, new Set(), true)).shadowAccounts;
    await expect(
      corrupt?.({ ...STRK20_SDK_CONTEXT, dappName: "scope", nonces: [0n] }),
    ).rejects.toThrow("unexpected result shape");
    const { shadowAccounts } = reads(anonymizerAnswering(calls, new Set()));
    await expect(
      shadowAccounts?.({
        ...STRK20_SDK_CONTEXT,
        config: { ...STRK20_SDK_CONTEXT.config, shadowAccountAnonymizerAddress: undefined },
        dappName: "scope",
        nonces: [0n],
      } as never),
    ).rejects.toThrow("strk20 services unavailable");
    await expect(
      shadowAccounts?.({ ...STRK20_SDK_CONTEXT, dappName: "scope", nonces: [1n << 64n] }),
    ).rejects.toThrow("outside the anonymizer's range");
    // 2^64 − 1 would need end_nonce 2^64, which is not a u64 (audit F4).
    await expect(
      shadowAccounts?.({ ...STRK20_SDK_CONTEXT, dappName: "scope", nonces: [(1n << 64n) - 1n] }),
    ).rejects.toThrow("outside the anonymizer's range");
    const unreachable = reads(
      () =>
        ({ callContract: async () => Promise.reject(new Error("down")) }) as unknown as RpcProvider,
    ).shadowAccounts;
    await expect(
      unreachable?.({ ...STRK20_SDK_CONTEXT, dappName: "scope", nonces: [0n] }),
    ).rejects.toThrow("did not answer get_shadow_accounts");
  });
});
