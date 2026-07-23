/**
 * Counterfactual account deployment RPC surface: isAccountDeployed (via
 * ensureAccountDeployed), deployAccountContract, ensureAccountDeployed, the
 * getDeploymentStatus address guard + happy paths, and submitAccountDeployment's
 * already-deployed guard. The RPC seam is driven two ways: an injected fake
 * provider object for ensureAccountDeployed, and a local JSON-RPC stub server
 * for the withRpcFallback-based getDeploymentStatus / submitAccountDeployment.
 */
import { describe, expect, test } from "bun:test";
import { type Account, CallData, hash, type RpcProvider } from "starknet";
import {
  ensureAccountDeployed,
  getDeploymentStatus,
  submitAccountDeployment,
} from "../src/starknet/deployment";
import type { AccountRef } from "../src/storage/vault-schema";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const CLASS_HASH = "0x2b31e19e45c06f29234e06e2ee98a9966479ba3067f8785ed972794fdb0065c";
// Krusty (salt 0) counterfactual address, so ozAccountDeployment resolves.
const DEPLOY_ADDRESS = hash.calculateContractAddressFromHash(
  "0x0",
  CLASS_HASH,
  CallData.compile([PUBLIC_KEY]),
  0,
);

const account: AccountRef = {
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
  ({ deployAccount }) as unknown as Account;

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
    );
    expect(deployed).toBe(true);
    expect(waited).toBe(true);
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
      ),
    ).rejects.toThrow("automatic deployment failed");
  });

  test("re-throws a WalletError from deployment as-is (address mismatch)", async () => {
    const mismatched: AccountRef = { ...account, address: "0xdead" };
    await expect(
      ensureAccountDeployed(
        provider({
          async getClassHashAt() {
            throw notFoundError();
          },
        }),
        starknetAccount(async () => ({ transaction_hash: "0x1" })),
        mismatched,
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

describe("submitAccountDeployment", () => {
  test("refuses when the account is already deployed", async () => {
    await expect(
      submitAccountDeployment(
        {
          account,
          rpcUrls: ["https://rpc.example"],
          signHash: async () => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" }),
        },
        () => makeProvider(true),
      ),
    ).rejects.toThrow("Account is already deployed");
  });
});
