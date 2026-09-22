/** Argent DEPLOY_ACCOUNT query signatures and validation-enabled fee settlement. */

import { expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
  argentAccountAddress,
  argentMultisigAddress,
} from "@bramble/starknet/account-contracts";
import {
  estimateAccountDeploymentFee,
  isCompatibleAccountDeployed,
  requireLiveAuthorizableClass,
  submitAccountDeployment,
} from "@bramble/starknet/deployment";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";

// Argent 0.3.0: recognized by the catalog, but it expects a bare (r, s).
const ARGENT_0_3_0 = "0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003";

import type { Account, RpcProvider } from "starknet";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const RPC_URLS = ["https://rpc.example"];

const account: DerivedAccountRef = {
  accountContractType: "argent",
  address: argentAccountAddress(PUBLIC_KEY),
  classHash: ARGENT_ACCOUNT_CONTRACT.classHash,
  deploymentSalt: PUBLIC_KEY,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${argentAccountAddress(PUBLIC_KEY)}`,
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};

const notFoundError = (): Error =>
  Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });

const makeQueryProvider = (liveClassHash: string | null = null) => {
  const calls: Array<{ readonly args: readonly unknown[]; readonly method: string }> = [];
  const channel = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property === "symbol") return undefined;
        const method = String(property);
        return async (...args: readonly unknown[]) => {
          calls.push({ args, method });
          if (method === "getEstimateFee") {
            return [
              {
                l1_data_gas_consumed: "0x1",
                l1_data_gas_price: "0x1",
                l1_gas_consumed: "0x1",
                l1_gas_price: "0x1",
                l2_gas_consumed: "0x1",
                l2_gas_price: "0x1",
                overall_fee: "0x3",
                unit: "FRI",
              },
            ];
          }
          if (method === "getChainId") return "0x534e5f4d41494e";
          if (method === "getNonceForAddress") return "0x0";
          if (method === "getBlockWithTxs") {
            return { block_number: 100, timestamp: 1_700_000_000, transactions: [] };
          }
          if (method === "specVersion") return "0.8.1";
          return undefined;
        };
      },
    },
  );
  const provider = {
    channel,
    async callContract() {
      return [PUBLIC_KEY];
    },
    async getChainId() {
      return "0x534e5f4d41494e";
    },
    async getBlockLatestAccepted() {
      return { block_hash: "0xabc" };
    },
    async getClassHashAt() {
      if (liveClassHash !== null) return liveClassHash;
      throw notFoundError();
    },
  } as unknown as RpcProvider;
  return { calls, provider };
};

const requestFor = (
  calls: readonly { readonly args: readonly unknown[]; readonly method: string }[],
): string =>
  JSON.stringify(
    calls.find((call) => call.method === "getEstimateFee"),
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
  );

test("validates a 2-of-2 Argent multisig deployment with one query signature", async () => {
  const config = { signerPublicKeys: ["0x456", "0x123"], threshold: 2 } as const;
  const salt = "0x789";
  const address = argentMultisigAddress(config, salt);
  const multisig = {
    accountContractType: "argent-multisig" as const,
    address,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    deployment: { ...config, salt },
    networkId: "SN_MAIN" as const,
  };
  const { calls, provider } = makeQueryProvider();
  let signed = false;

  const fee = await estimateAccountDeploymentFee(
    {
      account: multisig,
      rpcUrls: RPC_URLS,
      signHash: async () => {
        signed = true;
        return { publicKey: "0x123", r: "0x1", s: "0x2" };
      },
    },
    () => provider,
  );

  const request = requestFor(calls);
  expect(fee).toEqual({ overallFee: "3", unit: "FRI" });
  expect(request).toContain('"signature":["1","0","0x123","0x1","0x1"]');
  expect(request).not.toContain('"signature":["2"');
  expect(request).not.toContain("SKIP_VALIDATE");
  expect(signed).toBe(false);
});

test("settles ordinary Argent deployment bounds with validated query signing", async () => {
  const { calls, provider } = makeQueryProvider();
  let signedBounds: unknown;

  await expect(
    submitAccountDeployment(
      {
        account,
        reviewedFee: { overallFee: "1000", unit: "FRI" },
        rpcUrls: RPC_URLS,
        signHash: async () => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" }),
      },
      () => provider,
      (_provider, _stored, guardedSignHash) =>
        ({
          async deployAccount(_payload: unknown, details: unknown) {
            signedBounds = details;
            await guardedSignHash("0x123");
            return { transaction_hash: "0x123" };
          },
          async estimateAccountDeployFee() {
            throw new Error("private account must not estimate Argent deployment bounds");
          },
        }) as unknown as Account,
    ),
  ).resolves.toEqual({ transactionHash: "0x123" });

  const request = requestFor(calls);
  expect(request).toContain(`"signature":["1","0","${PUBLIC_KEY}","0x1","0x1"]`);
  expect(request).not.toContain("SKIP_VALIDATE");
  expect(signedBounds).toMatchObject({ resourceBounds: expect.any(Object) });
});

test("Argent deployment estimate and submission reject a different live class", async () => {
  let signed = 0;
  const input = {
    account,
    reviewedFee: { overallFee: "1000", unit: "FRI" } as const,
    rpcUrls: RPC_URLS,
    signHash: async () => {
      signed += 1;
      return { publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" };
    },
  };

  for (const operation of [
    () => estimateAccountDeploymentFee(input, () => makeQueryProvider("0x456").provider),
    () => submitAccountDeployment(input, () => makeQueryProvider("0x456").provider),
  ]) {
    await expect(operation()).rejects.toThrow("is not a release this wallet recognizes");
  }
  expect(signed).toBe(0);
});

// A provider reporting `liveClassHash` at the address, whose signer state
// matches this wallet: owner is our key, plain Starknet signer, no guardian.
const deployedAs = (liveClassHash: string): RpcProvider =>
  ({
    callContract: async ({ entrypoint }: { readonly entrypoint: string }) =>
      entrypoint === "get_owner" ? [PUBLIC_KEY] : ["0x0"],
    getBlockLatestAccepted: async () => ({ block_hash: "0x9", block_number: 100 }),
    getClassHashAt: async () => liveClassHash,
  }) as unknown as RpcProvider;

test("accepts an account that upgraded to a class it can authorize for", async () => {
  // The address is fixed by the class the account was DEPLOYED with; the class
  // it runs can change, and Ready moved its users through exactly that upgrade.
  // Requiring equality with the stored class refused accounts that work.
  const upgraded = { ...account, classHash: ARGENT_0_3_0 };
  expect(
    await isCompatibleAccountDeployed(deployedAs(ARGENT_ACCOUNT_CONTRACT.classHash), upgraded),
  ).toBe(true);
});

test("refuses a signature for an Argent account that still runs 0.3.x", async () => {
  await expect(requireLiveAuthorizableClass(deployedAs(ARGENT_0_3_0), account)).rejects.toThrow(
    "expects an authorization format this wallet does not produce",
  );
});

test("accepts a signature for an Argent account that upgraded to a class it can encode", async () => {
  const deployedAt030 = { ...account, classHash: ARGENT_0_3_0 };
  await expect(
    requireLiveAuthorizableClass(deployedAs(ARGENT_ACCOUNT_CONTRACT.classHash), deployedAt030),
  ).resolves.toBeUndefined();
});

test("refuses a signature for an undeployed historical Argent class", async () => {
  const undeployed = {
    getBlockLatestAccepted: async () => ({ block_hash: "0x9", block_number: 100 }),
    getClassHashAt: async () => {
      throw new Error("Contract not found");
    },
  } as unknown as RpcProvider;
  await expect(
    requireLiveAuthorizableClass(undeployed, { ...account, classHash: ARGENT_0_3_0 }),
  ).rejects.toThrow("expects an authorization format this wallet does not produce");
});

test("refuses a recognized class whose authorization format it cannot produce", async () => {
  // Recognition is not enough. This wallet emits Argent 0.4's signer-array
  // encoding; 0.3.x expects a bare (r, s), so acting for one would build a
  // transaction the account rejects. The refusal names that reason rather than
  // reporting an unknown class.
  await expect(isCompatibleAccountDeployed(deployedAs(ARGENT_0_3_0), account)).rejects.toThrow(
    "expects an authorization format this wallet does not produce",
  );
});
