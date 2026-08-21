/** Frozen Argent multisig V3 hashing, query estimation, and exact submission. */

import { describe, expect, test } from "bun:test";
import { ARGENT_MULTISIG_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import {
  type ArgentMultisigCall,
  ArgentMultisigFeeExpiredError,
  isPreparedArgentMultisigInvokeV3,
  prepareArgentMultisigInvokeV3WithProvider,
  preparedArgentMultisigFee,
  samePreparedArgentMultisigInvokeV3,
  submitPreparedArgentMultisigInvokeV3,
} from "@mc-wallet/starknet/multisig-invoke";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import { RpcError, RpcProvider } from "starknet";

const ACCOUNT = {
  accountContractType: "argent-multisig" as const,
  address: "0x123",
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  networkId: "SN_MAIN" as const,
};
const CONFIG = { signerPublicKeys: ["0x456", "0x123"], threshold: 2 } as const;
const CALLS: readonly ArgentMultisigCall[] = [
  { calldata: ["0x3"], contractAddress: "0x2", entrypoint: "transfer" },
];
const BOUNDS = {
  l1_data_gas: { max_amount: 1n, max_price_per_unit: 2n },
  l1_gas: { max_amount: 3n, max_price_per_unit: 4n },
  l2_gas: { max_amount: 5n, max_price_per_unit: 6n },
};

type Seen = {
  estimates: unknown[];
  submissions: unknown[];
  transactionHash?: string;
};

const fakeProvider = (seen: Seen, resourceBounds: unknown = BOUNDS): RpcProvider =>
  Object.assign(Object.create(RpcProvider.prototype), {
    channel: { id: "test" },
    async getChainId() {
      return STARKNET_NETWORKS.SN_MAIN.chainId;
    },
    async getEstimateFeeBulk(invocations: unknown[]) {
      seen.estimates.push(invocations);
      return [{ overall_fee: 21n, resourceBounds, unit: "FRI" }];
    },
    async getNonceForAddress() {
      return "0x7";
    },
    async invokeFunction(invocation: unknown, details: unknown) {
      seen.submissions.push({ details, invocation });
      return { transaction_hash: seen.transactionHash };
    },
  }) as RpcProvider;

describe("prepared Argent multisig V3 invoke", () => {
  test("estimates with a query signature and freezes canonical hash fields", async () => {
    const seen: Seen = { estimates: [], submissions: [] };
    const prepared = await prepareArgentMultisigInvokeV3WithProvider(
      fakeProvider(seen),
      ACCOUNT,
      CALLS,
      CONFIG,
    );

    expect(prepared).toMatchObject({
      accountDeploymentData: [],
      calls: CALLS,
      chainId: STARKNET_NETWORKS.SN_MAIN.chainId,
      feeDataAvailabilityMode: "L1",
      nonce: "0x7",
      nonceDataAvailabilityMode: "L1",
      paymasterData: [],
      resourceBounds: {
        l1DataGas: { maxAmount: "0x1", maxPricePerUnit: "0x2" },
        l1Gas: { maxAmount: "0x3", maxPricePerUnit: "0x4" },
        l2Gas: { maxAmount: "0x5", maxPricePerUnit: "0x6" },
      },
      senderAddress: ACCOUNT.address,
      tip: "0x0",
      version: "0x3",
    });
    expect(isPreparedArgentMultisigInvokeV3(prepared)).toBe(true);
    expect(preparedArgentMultisigFee(prepared)).toEqual({ overallFee: "44", unit: "FRI" });
    expect(samePreparedArgentMultisigInvokeV3(prepared, structuredClone(prepared))).toBe(true);
    const estimated = (seen.estimates[0] as Array<{ signature: readonly string[] }>)[0];
    expect(estimated?.signature).toEqual([
      "2",
      "0",
      "0x123",
      "0x1",
      "0x1",
      "0",
      "0x456",
      "0x1",
      "0x1",
    ]);
  });

  test("rejects stored field or hash tampering", async () => {
    const seen: Seen = { estimates: [], submissions: [] };
    const prepared = await prepareArgentMultisigInvokeV3WithProvider(
      fakeProvider(seen),
      ACCOUNT,
      CALLS,
      CONFIG,
    );
    expect(isPreparedArgentMultisigInvokeV3({ ...prepared, nonce: "0x8" })).toBe(false);
    expect(isPreparedArgentMultisigInvokeV3({ ...prepared, transactionHash: "0x123" })).toBe(false);
    expect(
      isPreparedArgentMultisigInvokeV3({
        ...prepared,
        calls: [{ ...prepared.calls[0], calldata: ["0x4"] }],
      }),
    ).toBe(false);
    expect(isPreparedArgentMultisigInvokeV3({ ...prepared, paymasterData: ["0x1"] })).toBe(false);
    expect(isPreparedArgentMultisigInvokeV3({ ...prepared, accountDeploymentData: ["0x1"] })).toBe(
      false,
    );
    expect(() => preparedArgentMultisigFee({ ...prepared, resourceBounds: {} } as never)).toThrow(
      "Invalid prepared Argent multisig transaction",
    );
    expect(isPreparedArgentMultisigInvokeV3({ ...prepared, tip: "0x1" })).toBe(false);
    expect(isPreparedArgentMultisigInvokeV3({ ...prepared, feeDataAvailabilityMode: "L2" })).toBe(
      false,
    );
    expect(isPreparedArgentMultisigInvokeV3({ ...prepared, nonceDataAvailabilityMode: "L2" })).toBe(
      false,
    );
    expect(isPreparedArgentMultisigInvokeV3({ ...prepared, calldata: new Array(1_000_000) })).toBe(
      false,
    );
  });

  test("rejects coercive inputs before freezing", async () => {
    const seen: Seen = { estimates: [], submissions: [] };
    const sparse = new Array<ArgentMultisigCall>(1);
    await expect(
      prepareArgentMultisigInvokeV3WithProvider(fakeProvider(seen), ACCOUNT, sparse, CONFIG),
    ).rejects.toThrow("Invalid Argent multisig calls");
    await expect(
      prepareArgentMultisigInvokeV3WithProvider(
        fakeProvider(seen, { ...BOUNDS, future_gas: { max_amount: 1n, max_price_per_unit: 1n } }),
        ACCOUNT,
        CALLS,
        CONFIG,
      ),
    ).rejects.toThrow("Invalid Argent multisig resource bounds");
  });

  test("submits exact frozen fields and a sorted full aggregate", async () => {
    const seen: Seen = { estimates: [], submissions: [] };
    const provider = fakeProvider(seen);
    const prepared = await prepareArgentMultisigInvokeV3WithProvider(
      provider,
      ACCOUNT,
      CALLS,
      CONFIG,
    );
    seen.transactionHash = prepared.transactionHash;

    await expect(
      submitPreparedArgentMultisigInvokeV3(
        {
          config: CONFIG,
          prepared,
          rpcUrls: ["https://one.invalid"],
          signatures: [
            { publicKey: "0x456", r: "0x3", s: "0x4" },
            { publicKey: "0x123", r: "0x1", s: "0x2" },
          ],
        },
        () => provider,
      ),
    ).resolves.toBe(prepared.transactionHash);

    expect(seen.estimates).toHaveLength(1);
    expect(seen.submissions).toHaveLength(1);
    expect(seen.submissions[0]).toMatchObject({
      details: {
        accountDeploymentData: [],
        nonce: "0x7",
        paymasterData: [],
        tip: "0x0",
        version: "0x3",
      },
      invocation: {
        calldata: prepared.calldata,
        contractAddress: prepared.senderAddress,
        signature: ["2", "0", "0x123", "0x1", "0x2", "0", "0x456", "0x3", "0x4"],
      },
    });
  });

  test("fails closed on a chain mismatch and a mismatched accepted hash", async () => {
    const seen: Seen = { estimates: [], submissions: [] };
    const provider = fakeProvider(seen);
    const prepared = await prepareArgentMultisigInvokeV3WithProvider(
      provider,
      ACCOUNT,
      CALLS,
      CONFIG,
    );
    seen.transactionHash = "0x999";
    await expect(
      submitPreparedArgentMultisigInvokeV3(
        {
          config: CONFIG,
          prepared,
          rpcUrls: ["https://one.invalid"],
          signatures: [
            { publicKey: "0x123", r: "0x1", s: "0x2" },
            { publicKey: "0x456", r: "0x3", s: "0x4" },
          ],
        },
        () => provider,
      ),
    ).rejects.toThrow("different transaction hash");
  });

  test("curates an expired resource-price bound without hiding other RPC errors", async () => {
    const seen: Seen = { estimates: [], submissions: [] };
    const provider = fakeProvider(seen);
    const prepared = await prepareArgentMultisigInvokeV3WithProvider(
      provider,
      ACCOUNT,
      CALLS,
      CONFIG,
    );
    provider.invokeFunction = async () => {
      throw new RpcError(
        {
          code: 55,
          data: "Resource bounds were not satisfied: Max L1Gas price (166545876311260) is lower than the actual gas price: 197626134159505. Max L1DataGas price (235129044270) is lower than the actual gas price: 863576035385.",
          message: "Account validation failed",
        },
        "starknet_addInvokeTransaction",
        { invoke_transaction: { type: "INVOKE" } },
      );
    };

    const submission = submitPreparedArgentMultisigInvokeV3(
      {
        config: CONFIG,
        prepared,
        rpcUrls: ["https://one.invalid"],
        signatures: [
          { publicKey: "0x123", r: "0x1", s: "0x2" },
          { publicKey: "0x456", r: "0x3", s: "0x4" },
        ],
      },
      () => provider,
    );
    await expect(submission).rejects.toBeInstanceOf(ArgentMultisigFeeExpiredError);
    await expect(submission).rejects.toThrow("Not submitted — network fees changed.");
  });

  test("rechecks live authorization at the final provider write boundary", async () => {
    const seen: Seen = { estimates: [], submissions: [] };
    const provider = fakeProvider(seen);
    const prepared = await prepareArgentMultisigInvokeV3WithProvider(
      provider,
      ACCOUNT,
      CALLS,
      CONFIG,
    );
    let authorized = true;
    const getChainId = provider.getChainId.bind(provider);
    provider.getChainId = async () => {
      const chainId = await getChainId();
      authorized = false;
      return chainId;
    };

    await expect(
      submitPreparedArgentMultisigInvokeV3(
        {
          config: CONFIG,
          isAuthorized: () => authorized,
          prepared,
          rpcUrls: ["https://one.invalid"],
          signatures: [
            { publicKey: "0x123", r: "0x1", s: "0x2" },
            { publicKey: "0x456", r: "0x3", s: "0x4" },
          ],
        },
        () => provider,
      ),
    ).rejects.toThrow("wallet locked");
    expect(seen.submissions).toHaveLength(0);
  });
});
