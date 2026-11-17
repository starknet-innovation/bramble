/**
 * submitDeclareTransaction unit coverage: the real function is driven against a
 * fake starknet provider/account so the sign+submit path runs end to end. The
 * provider reports the account already deployed (so ensureAccountDeployed short
 * circuits) and the account's declare returns node hashes, which the function
 * must surface as { classHash, transactionHash }. The optional classHash hint is
 * forwarded when present and omitted when absent.
 *
 * Provider/account factories are injected directly so this coverage remains
 * isolated and cannot replace the process-wide `starknet` module for sibling
 * tests running concurrently.
 */
import { describe, expect, test } from "bun:test";
import { ARGENT_ACCOUNT_CONTRACT, argentAccountAddress } from "@bramble/starknet/account-contracts";
import { estimateDeclareFee, submitDeclareTransaction } from "@bramble/starknet/declare";
import type { StarknetAccountDescriptor } from "@bramble/starknet/provider";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { type Account, CallData, type CompiledContract, hash, RpcProvider } from "starknet";

const declareCalls: Array<Record<string, unknown>> = [];
const classHashAtCalls: string[] = [];
const estimateCalls: Array<{
  readonly details: Record<string, unknown>;
  readonly payload: Record<string, unknown>;
}> = [];

class FakeRpcProvider {
  public async callContract(call: { readonly entrypoint?: unknown }): Promise<readonly string[]> {
    return [call.entrypoint === "get_owner_type" ? "0x0" : argentAccount.publicKeyX];
  }
  public async getChainId(): Promise<string> {
    return "0x534e5f4d41494e";
  }
  public async getClassHashAt(address: string): Promise<string> {
    classHashAtCalls.push(address);
    // A resolving getClassHashAt means the contract exists, so deployment is
    // skipped and the declare proceeds directly.
    return "0x1";
  }
  public async getBlockLatestAccepted(): Promise<{ readonly block_hash: string }> {
    return { block_hash: "0xabc" };
  }
}

class FakeAccount {
  public readonly address: string;
  public constructor(
    config: { address: string },
    private readonly signer: (hash: string) => Promise<unknown>,
  ) {
    this.address = config.address;
  }
  public async declare(payload: Record<string, unknown>): Promise<{
    class_hash: string;
    transaction_hash: string;
  }> {
    declareCalls.push(payload);
    await this.signer("0x7dec1a5e");
    return {
      class_hash: typeof payload["classHash"] === "string" ? payload["classHash"] : "0xc1a55",
      transaction_hash: "0x7dec1a5e",
    };
  }
  public async estimateDeclareFee(
    payload: Record<string, unknown>,
    details: Record<string, unknown>,
  ): Promise<{ overall_fee: bigint; resourceBounds: unknown; unit: string }> {
    estimateCalls.push({ details, payload });
    return {
      overall_fee: 2_500_000_000_000_000n,
      resourceBounds: { l1_gas: { max_amount: 2_500_000_000_000_000n, max_price_per_unit: 2n } },
      unit: "FRI",
    };
  }
}

const makeProvider = (): RpcProvider => new FakeRpcProvider() as unknown as RpcProvider;
const makeAccount = (
  _provider: RpcProvider,
  stored: StarknetAccountDescriptor,
  signer: (hash: string) => Promise<unknown>,
): Account => new FakeAccount({ address: stored.address }, signer) as unknown as Account;

const account: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  networkId: "SN_MAIN",
  publicKeyX: "0x3234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  publicKeyY: "0x4234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
const argentAccount: DerivedAccountRef = {
  ...account,
  accountContractType: "argent",
  address: argentAccountAddress(account.publicKeyX),
  classHash: ARGENT_ACCOUNT_CONTRACT.classHash,
  deploymentSalt: account.publicKeyX,
  id: `SN_MAIN:${argentAccountAddress(account.publicKeyX)}`,
};

const contractClass = {
  abi: [],
  contract_class_version: "0.1.0",
  entry_points_by_type: { CONSTRUCTOR: [], EXTERNAL: [], L1_HANDLER: [] },
  sierra_program: ["0x1"],
};
const contractClassHash = hash.computeContractClassHash(contractClass as CompiledContract);
const signHash = async () => ({ publicKey: account.publicKeyX, r: "0x1", s: "0x2" });

describe("submitDeclareTransaction", () => {
  test("estimates with validation skipped and never invokes the signer", async () => {
    estimateCalls.length = 0;
    let signed = false;

    const fee = await estimateDeclareFee(
      {
        account,
        classHash: contractClassHash,
        compiledClassHash: "0x6def",
        contractClass,
        rpcUrls: ["https://rpc.example"],
        signHash: async () => {
          signed = true;
          return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
        },
      },
      makeProvider,
      makeAccount,
    );

    expect(fee).toEqual({ overallFee: "5000000000000000", unit: "FRI" });
    expect(signed).toBe(false);
    expect(estimateCalls).toEqual([
      {
        details: { skipValidate: true, tip: "0x0" },
        payload: {
          classHash: contractClassHash,
          compiledClassHash: "0x6def",
          contract: contractClass,
        },
      },
    ]);
  });

  test("signs, submits, and returns the node's class and transaction hashes", async () => {
    declareCalls.length = 0;
    classHashAtCalls.length = 0;

    const result = await submitDeclareTransaction(
      {
        account,
        classHash: contractClassHash,
        compiledClassHash: "0x6def",
        contractClass,
        rpcUrls: ["https://rpc.example"],
        signHash,
      },
      makeProvider,
      makeAccount,
    );

    expect(result).toEqual({ classHash: contractClassHash, transactionHash: "0x7dec1a5e" });
    // Deployment was checked (and found already deployed) before declaring.
    expect(classHashAtCalls).toEqual([account.address]);
    // The declare payload carries the compiled class hash and forwards the hint.
    expect(declareCalls).toHaveLength(1);
    expect(declareCalls[0]).toMatchObject({
      classHash: contractClassHash,
      compiledClassHash: "0x6def",
    });
    expect(declareCalls[0]?.["contract"]).toBe(contractClass);
  });

  test("checks live authorization immediately before declaring", async () => {
    declareCalls.length = 0;
    let signed = false;
    await expect(
      submitDeclareTransaction(
        {
          account,
          classHash: contractClassHash,
          compiledClassHash: "0x6def",
          contractClass,
          isAuthorized: () => false,
          rpcUrls: ["https://rpc.example"],
          signHash: async () => {
            signed = true;
            return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
          },
        },
        makeProvider,
        makeAccount,
      ),
    ).rejects.toThrow("wallet locked");
    expect(signed).toBe(false);
    expect(declareCalls).toHaveLength(0);
  });

  test("computes and binds the class hash when the optional hint is absent", async () => {
    declareCalls.length = 0;

    const result = await submitDeclareTransaction(
      {
        account,
        compiledClassHash: "0x6def",
        contractClass,
        rpcUrls: ["https://rpc.example"],
        signHash,
      },
      makeProvider,
      makeAccount,
    );

    expect(result).toEqual({ classHash: contractClassHash, transactionHash: "0x7dec1a5e" });
    expect(declareCalls[0]).toMatchObject({
      classHash: contractClassHash,
      compiledClassHash: "0x6def",
    });
  });

  test("rejects a supplied class hash that does not match the contract class", async () => {
    estimateCalls.length = 0;
    await expect(
      estimateDeclareFee(
        {
          account,
          classHash: "0x5abc",
          compiledClassHash: "0x6def",
          contractClass,
          rpcUrls: ["https://rpc.example"],
          signHash,
        },
        makeProvider,
        makeAccount,
      ),
    ).rejects.toThrow("does not match the Starknet contract class");
    expect(estimateCalls).toHaveLength(0);
  });

  test("treats a malformed successful broadcast response as indeterminate", async () => {
    const malformedAccount = (
      _provider: RpcProvider,
      _stored: StarknetAccountDescriptor,
      signer: (hash: string) => Promise<unknown>,
    ) =>
      ({
        async declare() {
          await signer("0xdec");
          return { class_hash: "0xc1a55" };
        },
        async estimateDeclareFee() {
          return {
            overall_fee: 1n,
            resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
            unit: "FRI",
          };
        },
      }) as unknown as Account;

    await expect(
      submitDeclareTransaction(
        {
          account,
          compiledClassHash: "0x6def",
          contractClass,
          rpcUrls: ["https://rpc.example"],
          signHash,
        },
        makeProvider,
        malformedAccount,
      ),
    ).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
  });

  test("Argent declare estimate and submission reject a different live class", async () => {
    declareCalls.length = 0;
    let signed = 0;
    const input = {
      account: argentAccount,
      compiledClassHash: "0x6def",
      contractClass,
      rpcUrls: ["https://rpc.example"],
      signHash: async () => {
        signed += 1;
        return { publicKey: account.publicKeyX, r: "0x1", s: "0x2" };
      },
    };

    for (const operation of [
      () => estimateDeclareFee(input, makeProvider, makeAccount),
      () => submitDeclareTransaction(input, makeProvider, makeAccount),
    ]) {
      await expect(operation()).rejects.toThrow("is not a release this wallet recognizes");
    }
    expect(signed).toBe(0);
    expect(declareCalls).toHaveLength(0);
  });

  test("settles undeployed OZ and Argent declaration ceilings before deployment", async () => {
    const ozAddress = hash.calculateContractAddressFromHash(
      "0x0",
      account.classHash,
      CallData.compile([account.publicKeyX]),
      0,
    );
    const deployableOz: DerivedAccountRef = {
      ...account,
      address: ozAddress,
      id: `SN_MAIN:${ozAddress}`,
    };
    const estimates = [
      {
        overall_fee: 1n,
        resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
        unit: "FRI",
      },
      {
        overall_fee: 100n,
        resourceBounds: { l1_gas: { max_amount: 100n, max_price_per_unit: 1n } },
        unit: "FRI",
      },
    ];
    const bulkInvocations: unknown[] = [];
    const undeployedProvider = Object.assign(Object.create(RpcProvider.prototype), {
      channel: {
        id: "declare-test",
        async getStarknetVersion() {
          return "0.13.2";
        },
      },
      async getChainId() {
        return "0x534e5f4d41494e";
      },
      async getClassHashAt() {
        throw Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });
      },
      async getBlockLatestAccepted() {
        return { block_hash: "0xabc" };
      },
      async getEstimateFeeBulk(invocations: unknown[]) {
        bulkInvocations.push(invocations);
        return estimates;
      },
      async getNonceForAddress() {
        return "0x0";
      },
    }) as RpcProvider;
    let deploys = 0;
    const undeployedAccount = (
      _provider: RpcProvider,
      _stored: StarknetAccountDescriptor,
      _signer: (hash: string) => Promise<unknown>,
    ) =>
      ({
        async deployAccount() {
          deploys += 1;
          return { transaction_hash: "0x1" };
        },
        async estimateFeeBulk() {
          return estimates;
        },
      }) as unknown as Account;

    const errors: string[] = [];
    for (const candidate of [deployableOz, argentAccount]) {
      const error = await submitDeclareTransaction(
        {
          account: candidate,
          classHash: contractClassHash,
          compiledClassHash: "0x6def",
          contractClass,
          reviewedDeploymentFee: { overallFee: "100", unit: "FRI" },
          reviewedFee: { overallFee: "1", unit: "FRI" },
          rpcUrls: ["https://rpc.example"],
          signHash,
        },
        () => undeployedProvider,
        undeployedAccount,
      ).catch((thrown: unknown) => thrown);
      errors.push(`${candidate.accountContractType}:${(error as Error).message}`);
    }
    expect(errors).toEqual([
      "openzeppelin:The network fee for this declaration rose above the amount you reviewed. Nothing was submitted — review it again.",
      "argent:The network fee for this declaration rose above the amount you reviewed. Nothing was submitted — review it again.",
    ]);
    expect(deploys).toBe(0);
    expect(bulkInvocations).toHaveLength(1);
    expect(bulkInvocations[0] as readonly unknown[]).toHaveLength(2);
  });

  test("discloses a completed deployment when the following declaration fails", async () => {
    const address = hash.calculateContractAddressFromHash(
      "0x0",
      account.classHash,
      CallData.compile([account.publicKeyX]),
      0,
    );
    const deployable: DerivedAccountRef = { ...account, address, id: `SN_MAIN:${address}` };
    const fee = {
      overall_fee: 1n,
      resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
      unit: "FRI",
    };
    const provider = {
      async getChainId() {
        return "0x534e5f4d41494e";
      },
      async getClassHashAt() {
        throw Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });
      },
      async waitForTransaction() {},
    } as unknown as RpcProvider;
    const accountWithFailure = (
      _provider: RpcProvider,
      _stored: StarknetAccountDescriptor,
      signer: (hash: string) => Promise<unknown>,
    ) =>
      ({
        async declare() {
          await signer("0xbbb");
          throw Object.assign(new Error("declare rejected"), { baseError: { code: 53 } });
        },
        async deployAccount() {
          await signer("0xaaa");
          return { transaction_hash: "0xaaa" };
        },
        async estimateAccountDeployFee() {
          return fee;
        },
        async estimateFeeBulk() {
          return [fee, fee];
        },
      }) as unknown as Account;

    await expect(
      submitDeclareTransaction(
        {
          account: deployable,
          classHash: contractClassHash,
          compiledClassHash: "0x6def",
          contractClass,
          reviewedDeploymentFee: { overallFee: "10", unit: "FRI" },
          reviewedFee: { overallFee: "10", unit: "FRI" },
          rpcUrls: ["https://rpc.example"],
          signHash,
        },
        () => provider,
        accountWithFailure,
      ),
    ).rejects.toThrow("Account deployment 0xaaa completed");
  });

  test("treats mismatched accepted transaction and declared class hashes as indeterminate", async () => {
    for (const returned of [
      { class_hash: contractClassHash, transaction_hash: "0x222" },
      { class_hash: "0x999", transaction_hash: "0x111" },
    ]) {
      const mismatchedAccount = (
        _provider: RpcProvider,
        _stored: StarknetAccountDescriptor,
        signer: (hash: string) => Promise<unknown>,
      ) =>
        ({
          async declare() {
            await signer("0x111");
            return returned;
          },
          async estimateDeclareFee() {
            return {
              overall_fee: 1n,
              resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
              unit: "FRI",
            };
          },
        }) as unknown as Account;

      await expect(
        submitDeclareTransaction(
          {
            account,
            classHash: contractClassHash,
            compiledClassHash: "0x6def",
            contractClass,
            rpcUrls: [`https://rpc-${returned.transaction_hash}.example`],
            signHash,
          },
          makeProvider,
          mismatchedAccount,
        ),
      ).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
    }
  });
});
