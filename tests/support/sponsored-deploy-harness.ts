/**
 * Shared doubles for the sponsored-deploy suites (issue 431): a deployable
 * OpenZeppelin account, a fake SNIP-29 relay, and handler deps with a mutable
 * chain answer and an injectable pending-deployment store.
 */
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { type ActivityLog, memoryActivityLog } from "@bramble/transactions/activity";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { hash } from "starknet";
import type { DeployAccountDeps } from "../../apps/extension/src/background/accounts/deploy-account-ops";
import {
  memoryPendingDeployments,
  type PendingDeployments,
} from "../../apps/extension/src/background/accounts/pending-deployments";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { createWallet, vaultPassphrase } from "./background-wallet-stub";
import { makeRuntimeRpc } from "./runtime-rpc-stub";

const CLASS_HASH = "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";
const PUBLIC_KEY = "0x1f3c942d7f492a37608cde0d77b884a5aa9e11d2919225968557370ddb5a5aa";
const ADDRESS = hash.calculateContractAddressFromHash(PUBLIC_KEY, CLASS_HASH, [PUBLIC_KEY], 0);

// The one relay the suites turn on.
const SPONSOR_RELAY = { SN_SEPOLIA: { url: "https://gateway.test/sponsor" } };

/** An undeployed OpenZeppelin account whose deployment data reproduces its address. */
export const ozAccount: AccountRef = {
  accountContractType: "openzeppelin",
  address: ADDRESS,
  classHash: CLASS_HASH,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_SEPOLIA:${ADDRESS}`,
  networkId: "SN_SEPOLIA",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x2",
};

/** The same keys as a Braavos account, which the sponsored route refuses. */
export const braavosAccount: AccountRef = {
  ...ozAccount,
  accountContractType: "braavos",
  deploymentSalt: PUBLIC_KEY,
};

/** A fake relay and the JSON-RPC methods it was asked, in order. */
export type Relay = {
  readonly calls: string[];
  readonly http: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/**
 * A relay that sponsors (`buildTransaction` echoes the request) or declines
 * (`quote` false), and answers the broadcast with `execute`.
 */
export const relay = (execute: () => Promise<Response> | Response, quote = true): Relay => {
  const calls: string[] = [];
  return {
    calls,
    http: async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        method: string;
        params: { parameters: unknown; transaction: { deployment: unknown } };
      };
      calls.push(request.method);
      if (request.method === "paymaster_executeTransaction") return execute();
      return quote
        ? json({
            id: "bramble-strk20",
            jsonrpc: "2.0",
            result: {
              deployment: request.params.transaction.deployment,
              parameters: request.params.parameters,
              type: "deploy",
            },
          })
        : json({
            error: { code: 163, message: "sponsorship limit reached" },
            id: "bramble-strk20",
            jsonrpc: "2.0",
          });
    },
  };
};

/** An accepted broadcast. */
export const accepted = (): Response =>
  json({ id: "bramble-strk20", jsonrpc: "2.0", result: { transaction_hash: "0x5ab" } });

/** A broadcast whose answer was lost. */
export const lost = (): Response => new Response("bad gateway", { status: 502 });

/** What the chain answers for the account's deployment status; tests may flip it. */
export type Chain = { deployed: boolean | Error };

/** Handler deps over the doubles above; shared `pending`/`activity` survive a "restart". */
export const sponsoredHarness = async (input: {
  readonly account?: AccountRef;
  readonly activity?: ActivityLog;
  readonly balance?: string;
  readonly chain?: Chain;
  readonly deployed?: boolean | Error;
  readonly pending?: PendingDeployments;
  readonly relay?: Relay;
  readonly relayOn?: boolean;
  readonly unlocked?: boolean;
}) => {
  const account = input.account ?? ozAccount;
  const chain = input.chain ?? { deployed: input.deployed ?? false };
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork("SN_SEPOLIA");
  const session = createUnlockSession();
  if (input.unlocked ?? true) session.unlock(vaultPassphrase);
  const activity = input.activity ?? memoryActivityLog();
  const pending = input.pending ?? memoryPendingDeployments();
  const runtimeRpc = makeRuntimeRpc({
    async estimateAccountDeploymentFee() {
      return { overallFee: "1000", unit: "FRI" };
    },
    async getDeploymentStatus() {
      if (chain.deployed instanceof Error) throw chain.deployed;
      return chain.deployed;
    },
    async getTokenBalances({ tokens }) {
      return tokens.map((token) => ({ ...token, balance: input.balance ?? "0", formatted: "0" }));
    },
  }) as RuntimeRpc;
  const deps: DeployAccountDeps = {
    activity,
    pendingDeployments: pending,
    preferencesStore,
    runtimeRpc,
    session,
    ...(input.relayOn === false
      ? {}
      : {
          sponsoredDeploy: {
            ...(input.relay ? { http: input.relay.http } : {}),
            networks: SPONSOR_RELAY,
          },
        }),
    wallet: createWallet({ accounts: [account], activeAccountId: () => account.id }),
  };
  return { activity, chain, deps, pending, preferencesStore, runtimeRpc, session };
};
