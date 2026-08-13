/**
 * What `submitInvokeTransaction` decides about fees.
 *
 * Speed: a `fast` send signs resource bounds scaled 1.5x from an estimate taken
 * at submission; an unbound standard send hands `execute` no bounds at all and
 * lets starknet.js estimate once internally. Both are pinned here so a change to
 * the scaling or to which speeds re-estimate cannot land silently.
 *
 * Consent (MCW-V09-119): when the caller carries the fee a user reviewed, that
 * figure is a ceiling. The exposure it closes is specific — the gas a call burns
 * can depend on state the requesting site controls, so a site can show a cheap
 * estimate, wait for the click, and flip that state while the card is open. So
 * these cases check four things and not just the first: that an over-ceiling
 * submission is REFUSED, that nothing was broadcast when it is (a refusal after
 * the broadcast is not a refusal), that the bounds actually signed come from the
 * estimate that was checked rather than a second quote taken afterwards, and
 * that what the reviewed figure is measured against is the spend those bounds
 * authorise — on the `fast` lane the two differ by the square of the scale, so
 * checking the estimate and then scaling it would bind nothing.
 */

import { describe, expect, test } from "bun:test";
import { submitInvokeTransaction } from "@mc-wallet/starknet/rpc-submit";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { type Call, logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const account: AccountRef = {
  accountContractType: "openzeppelin",
  address: ACCOUNT_ADDRESS,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${ACCOUNT_ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const call: Call = { calldata: [], contractAddress: "0x123", entrypoint: "transfer" };

// 100 l1 gas at 2 FRI, 10 l1 data gas at 2 FRI, 1000 l2 gas at 1 FRI. starknet.js
// adds its own 50% bound overhead when it turns an estimate into bounds.
const feeEstimate = {
  l1_data_gas_consumed: "0xa",
  l1_data_gas_price: "0x2",
  l1_gas_consumed: "0x64",
  l1_gas_price: "0x2",
  l2_gas_consumed: "0x3e8",
  l2_gas_price: "0x1",
  overall_fee: "0x7cb",
  unit: "FRI",
};

// The bounds starknet.js derives from that estimate on its own: what a standard
// send signs, and the base the `fast` scale-up is applied to.
const NODE_BOUNDS = {
  l1_data_gas: { max_amount: 15n, max_price_per_unit: 3n },
  l1_gas: { max_amount: 150n, max_price_per_unit: 3n },
  l2_gas: { max_amount: 1500n, max_price_per_unit: 1n },
};

type Submission = {
  bounds: unknown;
  broadcasts: number;
  estimateArgs: readonly unknown[];
  estimates: number;
  signedHash?: string;
};

// Drives one submission against a fake channel, recording what reached the
// broadcast and how many fee estimates the submission itself asked for.
const submit = async (
  speed?: "fast" | "standard",
  reviewedFee: { readonly overallFee: string; readonly unit: string } | null = {
    overallFee: "9999999",
    unit: "FRI",
  },
  proof = false,
): Promise<{ readonly result: unknown; readonly seen: Submission }> => {
  const seen: Submission = {
    bounds: undefined,
    broadcasts: 0,
    estimateArgs: [],
    estimates: 0,
  };
  const implementations = {
    async getEstimateFee(...args: readonly unknown[]) {
      seen.estimates += 1;
      seen.estimateArgs = args;
      return [feeEstimate];
    },
    async invoke(_invocation: unknown, details: { readonly resourceBounds?: unknown }) {
      seen.broadcasts += 1;
      seen.bounds = details.resourceBounds;
      return { transaction_hash: seen.signedHash };
    },
  };
  const responses: Readonly<Record<string, unknown>> = {
    getBlockWithTxs: { block_number: 100, timestamp: 1_700_000_000, transactions: [] },
    getChainId: "0x534e5f4d41494e",
    getNonceForAddress: "0x0",
    specVersion: "0.8.1",
  };
  const channel = new Proxy(implementations, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver);
      }
      if (typeof property === "symbol") {
        return undefined;
      }
      const method = String(property);
      return async () => responses[method];
    },
  });
  const provider = {
    channel,
    async getChainId() {
      return "0x534e5f4d41494e";
    },
    async getClassHashAt() {
      return "0xclass";
    },
  } as unknown as RpcProvider;
  const result = await submitInvokeTransaction(
    {
      account,
      calls: [call],
      ...(proof ? { proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] } } : {}),
      ...(reviewedFee ? { reviewedFee } : {}),
      rpcUrls: ["https://rpc.example"],
      async signHash(messageHash) {
        seen.signedHash = messageHash;
        return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
      },
      ...(speed === undefined ? {} : { speed }),
    },
    () => provider,
  ).catch((error: unknown) => error);
  return { result, seen };
};

describe("invoke submission fee bounds", () => {
  test("a fast send signs bounds scaled 1.5x above the node's own", async () => {
    const { result, seen } = await submit("fast");
    expect(result).toMatchObject({ transactionHash: seen.signedHash });
    expect(seen.broadcasts).toBe(1);
    expect(seen.bounds).toEqual({
      l1_data_gas: { max_amount: 22n, max_price_per_unit: 4n },
      l1_gas: { max_amount: 225n, max_price_per_unit: 4n },
      l2_gas: { max_amount: 2250n, max_price_per_unit: 1n },
    });
  });

  test("a standard send adds no bounds of its own and estimates once", async () => {
    const { result, seen } = await submit();
    expect(result).toMatchObject({ transactionHash: seen.signedHash });
    expect(seen.broadcasts).toBe(1);
    expect(seen.estimates).toBe(1);
    // Standard speed signs the same bounds that were compared to the review.
    expect(seen.bounds).toEqual(NODE_BOUNDS);
  });

  test("refuses a missing fee before touching the network", async () => {
    const { result, seen } = await submit("standard", null);
    expect((result as Error).message).toContain("fee was not reviewed");
    expect(seen.estimates).toBe(0);
    expect(seen.broadcasts).toBe(0);
  });

  test("estimates the exact proof-bearing invocation before signing it", async () => {
    const { result, seen } = await submit("standard", undefined, true);
    expect(result).toMatchObject({ transactionHash: seen.signedHash });
    expect(seen.estimateArgs[0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ proof: "proof", proofFacts: ["0x2"] })]),
    );
  });
});

// The node quotes 0x7cb = 1995 FRI at submission time. The headroom is 3/2, so
// a review of 1330 is exactly affordable and 1329 is exactly one unit short.
const QUOTED = 1_995;
const AT_CEILING = { overallFee: "1330", unit: "FRI" };
const ONE_SHORT = { overallFee: "1329", unit: "FRI" };

// What a `fast` submission actually signs, and therefore what its reviewed
// figure is measured against: every bound dimension scaled 1.5x, so the spend
// the signature authorises rises by the square of it.
const FAST_BOUNDS = {
  l1_data_gas: { max_amount: 22n, max_price_per_unit: 4n },
  l1_gas: { max_amount: 225n, max_price_per_unit: 4n },
  l2_gas: { max_amount: 2250n, max_price_per_unit: 1n },
};
const FAST_AUTHORIZED = 22 * 4 + 225 * 4 + 2250 * 1;

describe("the reviewed fee is a ceiling on what gets signed", () => {
  test("refuses to submit when the cost has outrun the reviewed figure", async () => {
    const { result, seen } = await submit("standard", { overallFee: "100", unit: "FRI" });
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("rose above the amount you reviewed");
    // Refused BEFORE the broadcast. A guard that fires afterwards has already
    // spent the user's money at a price they never agreed to.
    expect(seen.broadcasts).toBe(0);
  });

  test("signs the bounds it just checked rather than a second quote", async () => {
    const { result, seen } = await submit("standard", { overallFee: String(QUOTED), unit: "FRI" });
    expect(result).toMatchObject({ transactionHash: seen.signedHash });
    expect(seen.estimates).toBe(1);
    // Explicit bounds, even at standard speed: a ceiling checked against one
    // estimate while starknet.js quietly signs bounds from another would bind
    // nothing at all.
    expect(seen.bounds).toEqual(NODE_BOUNDS);
  });

  test("allows the whole headroom and not one unit more", async () => {
    const allowed = await submit("standard", AT_CEILING);
    expect(allowed.result).toMatchObject({ transactionHash: allowed.seen.signedHash });

    const refused = await submit("standard", ONE_SHORT);
    expect(refused.result).toBeInstanceOf(Error);
    expect(refused.seen.broadcasts).toBe(0);
  });

  test("refuses a reviewed figure denominated in another unit", async () => {
    // Not "close enough": WEI and FRI are different quantities, so the two
    // numbers cannot be compared and the wallet must not pretend they can.
    const { result, seen } = await submit("standard", { overallFee: String(QUOTED), unit: "WEI" });
    expect(result).toBeInstanceOf(Error);
    expect(seen.broadcasts).toBe(0);
  });

  test("binds a fast send to the bounds it signs, not the estimate they came from", async () => {
    // The defect this pins: `fast` multiplies BOTH bound dimensions by 3/2, so
    // the spend a fast signature authorises is 3238 where the node quoted 1995.
    // A check against the pre-scaling figure would pass a submission that then
    // signs for 1.6x what it just approved — and, at the ceiling, 3.2x what the
    // user reviewed. So the reviewed figure is compared against the SIGNED
    // bounds: a review of the node's own quote is refused on the fast lane.
    const refused = await submit("fast", { overallFee: String(QUOTED), unit: "FRI" });
    expect(refused.result).toBeInstanceOf(Error);
    expect(refused.seen.broadcasts).toBe(0);

    // 3238 is the whole of what the scaled bounds authorise: 22x4 + 225x4 +
    // 2250x1. Reviewed at that figure, the send goes out and signs exactly it.
    const allowed = await submit("fast", { overallFee: String(FAST_AUTHORIZED), unit: "FRI" });
    expect(allowed.result).toMatchObject({ transactionHash: allowed.seen.signedHash });
    expect(allowed.seen.bounds).toEqual(FAST_BOUNDS);
  });

  test("gives a fast send the same headroom as a standard one and no more", async () => {
    // 3238 authorised against a 3/2 headroom is affordable down to a reviewed
    // 2159 and no further. Pinned as an exact boundary because a headroom that
    // silently composes with the fast scale is the finding restated.
    const allowed = await submit("fast", { overallFee: "2159", unit: "FRI" });
    expect(allowed.result).toMatchObject({ transactionHash: allowed.seen.signedHash });

    const refused = await submit("fast", { overallFee: "2158", unit: "FRI" });
    expect(refused.result).toBeInstanceOf(Error);
    expect(refused.seen.broadcasts).toBe(0);
  });
});
