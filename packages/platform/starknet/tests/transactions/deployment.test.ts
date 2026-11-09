/**
 * Counterfactual account deployment RPC surface: isAccountDeployed (via
 * ensureAccountDeployed), deployAccountContract, ensureAccountDeployed, the
 * getDeploymentStatus address guard + happy paths, and submitAccountDeployment's
 * already-deployed guard. The RPC seam is driven two ways: an injected fake
 * provider object for ensureAccountDeployed, and a local JSON-RPC stub server
 * for the withRpcFallback-based getDeploymentStatus / submitAccountDeployment.
 */
import { describe, expect, test } from "bun:test";
import {
  ensureAccountDeployed,
  estimateAccountDeploymentFee,
  getDeploymentStatus,
  submitAccountDeployment,
} from "@bramble/starknet/deployment";
import { IndeterminateRpcWriteError } from "@bramble/starknet/provider";
import type { FeeEstimate } from "@bramble/starknet/rpc";
import type { DerivedAccountRef } from "@bramble/wallet-model/accounts";
import { type Account, CallData, hash, logger, type RpcProvider } from "starknet";

logger.setLogLevel("FATAL");

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const CLASS_HASH = "0x2b31e19e45c06f29234e06e2ee98a9966479ba3067f8785ed972794fdb0065c";
// Krusty (salt 0) counterfactual address, so accountDeployment resolves.
const DEPLOY_ADDRESS = hash.calculateContractAddressFromHash(
  "0x0",
  CLASS_HASH,
  CallData.compile([PUBLIC_KEY]),
  0,
);

const account: DerivedAccountRef = {
  accountContractType: "openzeppelin",
  address: DEPLOY_ADDRESS,
  classHash: CLASS_HASH,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${DEPLOY_ADDRESS}`,
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
};
// A "contract not found" RPC error the way starknet.js surfaces code 20.
const notFoundError = (): Error =>
  Object.assign(new Error("Contract not found"), { baseError: { code: 20 } });

type FakeProvider = {
  getClassHashAt: () => Promise<string>;
  waitForTransaction: () => Promise<void>;
};

const provider = (over: Partial<FakeProvider>): RpcProvider =>
  ({
    async getClassHashAt() {
      return CLASS_HASH;
    },
    async waitForTransaction() {},
    ...over,
  }) as unknown as RpcProvider;

const starknetAccount = (deployAccount: () => Promise<{ transaction_hash: string }>): Account =>
  ({
    deployAccount,
    async estimateAccountDeployFee() {
      return {
        overall_fee: 1n,
        resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
        unit: "FRI",
      };
    },
  }) as unknown as Account;

const REVIEWED_DEPLOYMENT = { overallFee: "1000", unit: "FRI" } as const;

describe("ensureAccountDeployed", () => {
  test("returns without deploying when the account class hash resolves", async () => {
    let deployed = false;
    await ensureAccountDeployed(
      provider({
        async getClassHashAt() {
          return CLASS_HASH;
        },
      }),
      starknetAccount(async () => {
        deployed = true;
        return { transaction_hash: "0x1" };
      }),
      account,
      REVIEWED_DEPLOYMENT,
      () => undefined,
    );
    expect(deployed).toBe(false);
  });

  test("deploys and waits for the transaction when the contract is not found", async () => {
    let deployed = false;
    let waited = false;
    await ensureAccountDeployed(
      provider({
        async getClassHashAt() {
          throw notFoundError();
        },
        async waitForTransaction() {
          waited = true;
        },
      }),
      starknetAccount(async () => {
        deployed = true;
        return { transaction_hash: "0xdeadbeef" };
      }),
      account,
      REVIEWED_DEPLOYMENT,
      () => "0xdeadbeef",
    );
    expect(deployed).toBe(true);
    expect(waited).toBe(true);
  });

  test("checks live authorization after fee settlement and before automatic deployment", async () => {
    let authorized = true;
    let deployed = false;
    let waited = false;
    const accountWithRevokingEstimate = {
      async deployAccount() {
        deployed = true;
        return { transaction_hash: "0xdeadbeef" };
      },
      async estimateAccountDeployFee() {
        authorized = false;
        return {
          overall_fee: 1n,
          resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
          unit: "FRI",
        };
      },
    } as unknown as Account;

    await expect(
      ensureAccountDeployed(
        provider({
          async getClassHashAt() {
            throw notFoundError();
          },
          async waitForTransaction() {
            waited = true;
          },
        }),
        accountWithRevokingEstimate,
        account,
        REVIEWED_DEPLOYMENT,
        () => undefined,
        () => authorized,
      ),
    ).rejects.toThrow("wallet locked");

    expect(deployed).toBe(false);
    expect(waited).toBe(false);
  });

  test("wraps a submission failure with the funding guidance", async () => {
    await expect(
      ensureAccountDeployed(
        provider({
          async getClassHashAt() {
            throw notFoundError();
          },
        }),
        starknetAccount(async () => {
          throw Object.assign(new Error("insufficient balance for fees"), {
            baseError: { code: 53, message: "insufficient balance for fees" },
          });
        }),
        account,
        REVIEWED_DEPLOYMENT,
        () => undefined,
      ),
    ).rejects.toThrow("automatic deployment failed");
  });

  test("does not conflate an ambiguous account deployment with the caller's later write", async () => {
    const rejection = await ensureAccountDeployed(
      provider({
        async getClassHashAt() {
          throw notFoundError();
        },
      }),
      starknetAccount(async () => {
        throw new IndeterminateRpcWriteError("safe inner deployment ambiguity");
      }),
      account,
      REVIEWED_DEPLOYMENT,
      () => undefined,
    ).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(IndeterminateRpcWriteError);
    expect((rejection as Error).message).toContain("Account deployment status is unknown");
  });

  test("re-throws a WalletError from deployment as-is (address mismatch)", async () => {
    const mismatched: DerivedAccountRef = { ...account, address: "0xdead" };
    await expect(
      ensureAccountDeployed(
        provider({
          async getClassHashAt() {
            throw notFoundError();
          },
        }),
        starknetAccount(async () => ({ transaction_hash: "0x1" })),
        mismatched,
        undefined,
        () => undefined,
      ),
    ).rejects.toThrow("do not match the stored address");
  });

  test("propagates a non-not-found error from the class-hash read", async () => {
    await expect(
      ensureAccountDeployed(
        provider({
          async getClassHashAt() {
            throw new Error("fetch failed");
          },
        }),
        starknetAccount(async () => ({ transaction_hash: "0x1" })),
        account,
        undefined,
        () => undefined,
      ),
    ).rejects.toThrow("fetch failed");
  });
});

const makeProvider = (deployed: boolean): RpcProvider =>
  ({
    async getChainId() {
      return "0x534e5f4d41494e";
    },
    async getClassHashAt() {
      if (!deployed) {
        throw notFoundError();
      }
      return CLASS_HASH;
    },
  }) as unknown as RpcProvider;

describe("getDeploymentStatus", () => {
  test("rejects a zero/invalid account address before any RPC call", async () => {
    await expect(
      getDeploymentStatus({ accountAddress: "0x0", rpcUrls: ["http://127.0.0.1:9"] }),
    ).rejects.toThrow("Invalid account address");
  });

  test("reports deployed when the class hash resolves", async () => {
    expect(
      await getDeploymentStatus(
        { accountAddress: DEPLOY_ADDRESS, rpcUrls: ["https://rpc.example"] },
        () => makeProvider(true),
      ),
    ).toBe(true);
  });

  test("reports not deployed on a contract-not-found (code 20) RPC error", async () => {
    expect(
      await getDeploymentStatus(
        { accountAddress: DEPLOY_ADDRESS, rpcUrls: ["https://rpc.example"] },
        () => makeProvider(false),
      ),
    ).toBe(false);
  });
});

describe("estimateAccountDeploymentFee", () => {
  test("uses the proven deployment parameters, skips validation, and never signs", async () => {
    let signed = false;
    let received: readonly unknown[] = [];
    const estimate = await estimateAccountDeploymentFee(
      {
        account,
        rpcUrls: ["https://rpc.example"],
        signHash: async () => {
          signed = true;
          return { publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" };
        },
      },
      () => makeProvider(false),
      () =>
        ({
          async estimateAccountDeployFee(payload: unknown, details: unknown) {
            received = [payload, details];
            return {
              overall_fee: 1_500_000_000_000_000n,
              resourceBounds: {
                l1_gas: { max_amount: 1_500_000_000_000_000n, max_price_per_unit: 2n },
              },
              unit: "FRI",
            };
          },
        }) as unknown as Account,
    );

    expect(estimate).toEqual({ overallFee: "3000000000000000", unit: "FRI" });
    expect(signed).toBe(false);
    expect(received).toEqual([
      {
        addressSalt: "0x0",
        classHash: CLASS_HASH,
        constructorCalldata: [BigInt(PUBLIC_KEY).toString()],
        contractAddress: DEPLOY_ADDRESS,
      },
      { skipValidate: true, tip: "0x0" },
    ]);
  });
});

describe("submitAccountDeployment", () => {
  test("refuses when the account is already deployed", async () => {
    await expect(
      submitAccountDeployment(
        {
          account,
          reviewedFee: REVIEWED_DEPLOYMENT,
          rpcUrls: ["https://rpc.example"],
          signHash: async () => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" }),
        },
        () => makeProvider(true),
      ),
    ).rejects.toThrow("Account is already deployed");
  });

  test("treats a malformed successful broadcast response as indeterminate", async () => {
    await expect(
      submitAccountDeployment(
        {
          account,
          reviewedFee: REVIEWED_DEPLOYMENT,
          rpcUrls: ["https://rpc.example"],
          signHash: async () => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" }),
        },
        () => makeProvider(false),
        (_provider, _stored, guardedSignHash) =>
          ({
            async deployAccount() {
              await guardedSignHash("0x123");
              return {};
            },
            estimateAccountDeployFee: async () => ({
              overall_fee: 1n,
              resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
              unit: "FRI",
            }),
          }) as unknown as Account,
      ),
    ).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
  });

  test("treats a node hash different from the signed deployment hash as indeterminate", async () => {
    await expect(
      submitAccountDeployment(
        {
          account,
          reviewedFee: REVIEWED_DEPLOYMENT,
          rpcUrls: ["https://rpc.example"],
          signHash: async () => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" }),
        },
        () => makeProvider(false),
        (_provider, _stored, guardedSignHash) =>
          ({
            async deployAccount() {
              await guardedSignHash("0x123");
              return { transaction_hash: "0x456" };
            },
            estimateAccountDeployFee: async () => ({
              overall_fee: 1n,
              resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
              unit: "FRI",
            }),
          }) as unknown as Account,
      ),
    ).rejects.toBeInstanceOf(IndeterminateRpcWriteError);
  });

  test("revocation after signing prevents the provider mutation", async () => {
    let authorized = true;
    let writes = 0;
    await expect(
      submitAccountDeployment(
        {
          account,
          isAuthorized: () => authorized,
          reviewedFee: REVIEWED_DEPLOYMENT,
          rpcUrls: ["https://rpc.example"],
          signHash: async () => {
            authorized = false;
            return { publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" };
          },
        },
        () => makeProvider(false),
        (_provider, _stored, guardedSignHash) =>
          ({
            async deployAccount() {
              await guardedSignHash("0x123");
              writes += 1;
              return { transaction_hash: "0x123" };
            },
            estimateAccountDeployFee: async () => ({
              overall_fee: 1n,
              resourceBounds: { l1_gas: { max_amount: 1n, max_price_per_unit: 1n } },
              unit: "FRI",
            }),
          }) as unknown as Account,
      ),
    ).rejects.toThrow("wallet locked");
    expect(writes).toBe(0);
  });
});

/**
 * MCW-V09-119, second half. The declare approval card shows an "Account
 * deployment fee" and folds it into an "Estimated total", and approving submits
 * that deployment first. Binding only the declaration would leave the larger
 * half of the total the user read enforced by nothing at all.
 */
describe("a reviewed deployment fee is a ceiling on the deployment", () => {
  type Seen = { bounds: unknown; deploys: number; estimates: number };
  // 10 gas at 3 FRI plus 100 gas at 2 FRI: bounds that authorise 230.
  const deployBounds = {
    l1_gas: { max_amount: 10n, max_price_per_unit: 3n },
    l2_gas: { max_amount: 100n, max_price_per_unit: 2n },
  };
  const runDeployment = async (reviewedFee?: FeeEstimate) => {
    const seen: Seen = { bounds: undefined, deploys: 0, estimates: 0 };
    const deploying = {
      async deployAccount(_payload: unknown, details?: { readonly resourceBounds?: unknown }) {
        seen.deploys += 1;
        seen.bounds = details?.resourceBounds;
        return { transaction_hash: "0xdeadbeef" };
      },
      async estimateAccountDeployFee() {
        seen.estimates += 1;
        return { overall_fee: 230n, resourceBounds: deployBounds, unit: "FRI" };
      },
    } as unknown as Account;
    const error = await ensureAccountDeployed(
      provider({
        async getClassHashAt() {
          throw notFoundError();
        },
      }),
      deploying,
      account,
      reviewedFee,
      () => "0xdeadbeef",
    ).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    return { error, seen };
  };

  test("refuses before deploying when the deployment has grown past the review", async () => {
    const { error, seen } = await runDeployment({ overallFee: "100", unit: "FRI" });
    expect((error as Error).message).toContain("account deployment fee rose above");
    // Nothing submitted. A guard that fires after the deployment has already
    // paid for it at a price the card never showed.
    expect(seen.deploys).toBe(0);
  });

  test("signs the bounds it checked, once", async () => {
    const { error, seen } = await runDeployment({ overallFee: "230", unit: "FRI" });
    expect(error).toBeNull();
    expect(seen.deploys).toBe(1);
    expect(seen.estimates).toBe(1);
    expect(seen.bounds).toEqual(deployBounds);
  });

  test("refuses before signing when no deployment fee was shown", async () => {
    const { error, seen } = await runDeployment();
    expect((error as Error).message).toContain("deployment fee was not reviewed");
    expect(seen.deploys).toBe(0);
    expect(seen.estimates).toBe(0);
    expect(seen.bounds).toBeUndefined();
  });
});
