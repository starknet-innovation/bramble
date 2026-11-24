/**
 * A dapp invoke from an Argent multisig: estimation only against the pinned
 * class, submission only at threshold 1 and never above the reviewed fee.
 */

import { describe, expect, test } from "bun:test";
import { ARGENT_MULTISIG_CONTRACT } from "@bramble/starknet/account-contracts";
import {
  estimateArgentMultisigDappFee,
  submitArgentMultisigDappInvoke,
} from "@bramble/starknet/multisig-dapp-invoke";
import {
  REVIEWED_FEE_EXCEEDED,
  REVIEWED_FEE_REQUIRED,
  type SignedInvoke,
} from "@bramble/starknet/rpc-submit";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { RpcProvider } from "starknet";

const ADDRESS = "0x05f1c0ab2b4f6f1c1fd3e2b4c7a9d8e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0";
const OWNER = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde";
const ACCOUNT = {
  accountContractType: "argent-multisig" as const,
  address: ADDRESS,
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  networkId: "SN_MAIN" as const,
};
const CALLS = [
  {
    calldata: ["0x3"],
    contractAddress: "0x0049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc",
    entrypoint: "transfer",
  },
];
const ONE_OF_ONE = { signerPublicKeys: [OWNER], threshold: 1 };
const TWO_OF_TWO = {
  signerPublicKeys: [OWNER, "0x0fedcba9876543210fedcba9876543210fedcba9876543210fedcba98765432"],
  threshold: 2,
};
const RPC = ["https://one.invalid"];
// The fake estimate's bounds price to 44 FRI at scale 1 (1*2 + 3*4 + 5*6).
const REVIEWED = { overallFee: "44", unit: "FRI" } as const;

type Seen = {
  classHash: string;
  estimates: bigint[];
  feeScale: bigint;
  signed: string[];
  submissions: Array<{ details: unknown; invocation: unknown }>;
};

const bounds = (scale: bigint) => ({
  l1_data_gas: { max_amount: 1n * scale, max_price_per_unit: 2n },
  l1_gas: { max_amount: 3n * scale, max_price_per_unit: 4n },
  l2_gas: { max_amount: 5n * scale, max_price_per_unit: 6n },
});

const fakeProvider = (seen: Seen): RpcProvider =>
  Object.assign(Object.create(RpcProvider.prototype), {
    channel: { id: "test" },
    async getChainId() {
      return STARKNET_NETWORKS.SN_MAIN.chainId;
    },
    async getClassHashAt() {
      return seen.classHash;
    },
    async getEstimateFeeBulk() {
      seen.estimates.push(seen.feeScale);
      return [
        { overall_fee: 44n * seen.feeScale, resourceBounds: bounds(seen.feeScale), unit: "FRI" },
      ];
    },
    async getNonceForAddress() {
      return "0x7";
    },
    async invokeFunction(invocation: unknown, details: unknown) {
      seen.submissions.push({ details, invocation });
      return { transaction_hash: seen.signed.at(-1) };
    },
  }) as RpcProvider;

const freshSeen = (overrides: Partial<Seen> = {}): Seen => ({
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  estimates: [],
  feeScale: 1n,
  signed: [],
  submissions: [],
  ...overrides,
});

const signer = (seen: Seen) => async (messageHash: string) => {
  seen.signed.push(messageHash);
  return { publicKey: OWNER, r: "0x1", s: "0x2" };
};

describe("Argent multisig dapp fee estimate", () => {
  test("estimates against the pinned multisig class", async () => {
    const seen = freshSeen();
    const fee = await estimateArgentMultisigDappFee(
      { account: ACCOUNT, calls: CALLS, config: ONE_OF_ONE, rpcUrls: RPC },
      () => fakeProvider(seen),
    );
    expect(fee).toEqual(REVIEWED);
    expect(seen.estimates).toHaveLength(1);
  });

  test("refuses an address whose live class is not the pinned multisig", async () => {
    const seen = freshSeen({ classHash: "0x1234" });
    await expect(
      estimateArgentMultisigDappFee(
        { account: ACCOUNT, calls: CALLS, config: ONE_OF_ONE, rpcUrls: RPC },
        () => fakeProvider(seen),
      ),
    ).rejects.toThrow("Argent multisig class hash does not match the pinned release");
    expect(seen.estimates).toHaveLength(0);
  });

  test("refuses an empty call list before any request", async () => {
    const seen = freshSeen();
    await expect(
      estimateArgentMultisigDappFee(
        { account: ACCOUNT, calls: [], config: ONE_OF_ONE, rpcUrls: RPC },
        () => fakeProvider(seen),
      ),
    ).rejects.toThrow("No calls to estimate");
    expect(seen.estimates).toHaveLength(0);
  });
});

describe("Argent multisig dapp submission", () => {
  test("signs once at the reviewed bounds and returns the signed hash", async () => {
    const seen = freshSeen();
    const recorded: SignedInvoke[] = [];
    const result = await submitArgentMultisigDappInvoke(
      {
        account: ACCOUNT,
        calls: CALLS,
        config: ONE_OF_ONE,
        onSigned: async (signed) => {
          recorded.push(signed);
        },
        reviewedFee: REVIEWED,
        rpcUrls: RPC,
        signHash: signer(seen),
      },
      () => fakeProvider(seen),
    );
    expect(seen.signed).toHaveLength(1);
    expect(seen.submissions).toHaveLength(1);
    expect(result.transactionHash).toBe(seen.signed[0] as string);
    expect(recorded).toEqual([
      { nonce: "0x7", senderAddress: ADDRESS, transactionHash: seen.signed[0] as string },
    ]);
  });

  test("refuses a fee that rose above the reviewed amount before signing", async () => {
    const seen = freshSeen({ feeScale: 2n });
    await expect(
      submitArgentMultisigDappInvoke(
        {
          account: ACCOUNT,
          calls: CALLS,
          config: ONE_OF_ONE,
          reviewedFee: REVIEWED,
          rpcUrls: RPC,
          signHash: signer(seen),
        },
        () => fakeProvider(seen),
      ),
    ).rejects.toThrow(REVIEWED_FEE_EXCEEDED);
    expect(seen.signed).toEqual([]);
    expect(seen.submissions).toEqual([]);
  });

  test("stops before signing when the wallet locks during submission", async () => {
    const seen = freshSeen();
    await expect(
      submitArgentMultisigDappInvoke(
        {
          account: ACCOUNT,
          calls: CALLS,
          config: ONE_OF_ONE,
          isAuthorized: () => false,
          reviewedFee: REVIEWED,
          rpcUrls: RPC,
          signHash: signer(seen),
        },
        () => fakeProvider(seen),
      ),
    ).rejects.toThrow("wallet locked");
    expect(seen.signed).toEqual([]);
    expect(seen.submissions).toEqual([]);
  });

  test("refuses the wrong class, a higher threshold, no calls and no reviewed fee", async () => {
    const base = {
      account: ACCOUNT,
      calls: CALLS,
      config: ONE_OF_ONE,
      reviewedFee: REVIEWED,
      rpcUrls: RPC,
    };
    const wrongClass = freshSeen({ classHash: "0x1234" });
    await expect(
      submitArgentMultisigDappInvoke({ ...base, signHash: signer(wrongClass) }, () =>
        fakeProvider(wrongClass),
      ),
    ).rejects.toThrow("Argent multisig class hash does not match the pinned release");

    const seen = freshSeen();
    const make = () => fakeProvider(seen);
    await expect(
      submitArgentMultisigDappInvoke({ ...base, config: TWO_OF_TWO, signHash: signer(seen) }, make),
    ).rejects.toThrow("Argent multisig threshold is above 1");
    await expect(
      submitArgentMultisigDappInvoke({ ...base, calls: [], signHash: signer(seen) }, make),
    ).rejects.toThrow("No calls to submit");
    await expect(
      submitArgentMultisigDappInvoke(
        { ...base, reviewedFee: undefined as never, signHash: signer(seen) },
        make,
      ),
    ).rejects.toThrow(REVIEWED_FEE_REQUIRED);
    expect([...wrongClass.signed, ...seen.signed]).toEqual([]);
    expect([...wrongClass.submissions, ...seen.submissions]).toEqual([]);
  });
});
