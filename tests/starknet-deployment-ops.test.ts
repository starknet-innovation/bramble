/**
 * Counterfactual account deployment RPC surface: isAccountDeployed (via
 * ensureAccountDeployed), deployAccountContract, ensureAccountDeployed, the
 * getDeploymentStatus address guard + happy paths, and submitAccountDeployment's
 * already-deployed guard. The RPC seam is driven two ways: an injected fake
 * provider object for ensureAccountDeployed, and a local JSON-RPC stub server
 * for the withRpcFallback-based getDeploymentStatus / submitAccountDeployment.
 */
import { afterAll, describe, expect, test } from "bun:test";
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
          throw new Error("insufficient balance for fees");
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

// A minimal JSON-RPC server answering the getClassHashAt method isAccountDeployed
// issues, so getDeploymentStatus / submitAccountDeployment can be driven through
// their real withRpcFallback path without a network. `deployed` chooses between a
// resolved class hash and a contract-not-found (code 20) error.
const startRpc = (deployed: boolean) => {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { id: number; method: string };
      const reply = (payload: object) => Response.json({ id: body.id, jsonrpc: "2.0", ...payload });
      if (body.method === "starknet_getClassHashAt") {
        return deployed
          ? reply({ result: CLASS_HASH })
          : reply({ error: { code: 20, message: "Contract not found" } });
      }
      if (body.method === "starknet_specVersion") {
        return reply({ result: "0.8.1" });
      }
      if (body.method === "starknet_chainId") {
        return reply({ result: "0x534e5f4d41494e" });
      }
      return reply({ result: "0x0" });
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}` };
};

const servers: { stop: (force?: boolean) => void }[] = [];
afterAll(() => {
  for (const server of servers) {
    server.stop(true);
  }
});

describe("getDeploymentStatus", () => {
  test("rejects a zero/invalid account address before any RPC call", async () => {
    await expect(
      getDeploymentStatus({ accountAddress: "0x0", rpcUrls: ["http://127.0.0.1:9"] }),
    ).rejects.toThrow("Invalid account address");
  });

  test("reports deployed when the class hash resolves", async () => {
    const { server, url } = startRpc(true);
    servers.push(server);
    expect(await getDeploymentStatus({ accountAddress: DEPLOY_ADDRESS, rpcUrls: [url] })).toBe(
      true,
    );
  });

  test("reports not deployed on a contract-not-found (code 20) RPC error", async () => {
    const { server, url } = startRpc(false);
    servers.push(server);
    expect(await getDeploymentStatus({ accountAddress: DEPLOY_ADDRESS, rpcUrls: [url] })).toBe(
      false,
    );
  });
});

describe("submitAccountDeployment", () => {
  test("refuses when the account is already deployed", async () => {
    const { server, url } = startRpc(true);
    servers.push(server);
    await expect(
      submitAccountDeployment({
        account,
        rpcUrls: [url],
        signHash: async () => ({ publicKey: PUBLIC_KEY, r: "0x1", s: "0x2" }),
      }),
    ).rejects.toThrow("Account is already deployed");
  });
});
