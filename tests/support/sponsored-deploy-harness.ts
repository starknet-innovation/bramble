/**
 * Shared doubles for the sponsored-deploy suites (issue 431): a deployable
 * OpenZeppelin account, a fake SNIP-29 relay, and handler deps with a mutable
 * chain answer and an injectable pending-deployment store.
 */
import { createPreferencesStore } from "@bramble/settings/preferences";
import { argentAccountConstructorCalldata } from "@bramble/starknet/account-contracts";
import { createMemoryStore } from "@bramble/store/kv";
import { type ActivityLog, memoryActivityLog } from "@bramble/transactions/activity";
import {
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  XVERSE_ARGENT_CLASS_HASH,
} from "@bramble/wallet-model/account-families";
import {
  type AccountRef,
  ARGENT_ACCOUNT_CLASS_HASH,
  OPENZEPPELIN_ACCOUNT_CLASS_HASH,
} from "@bramble/wallet-model/accounts";
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

const PUBLIC_KEY = "0x1f3c942d7f492a37608cde0d77b884a5aa9e11d2919225968557370ddb5a5aa";

/** OpenZeppelin 0.8.1: a real account class the gateway does not sponsor. */
export const OLDER_OZ_CLASS_HASH =
  "0x61dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f";

/** An undeployed OpenZeppelin account at `classHash` that reproduces its address. */
export const ozAccountAt = (classHash: string): AccountRef => {
  const address = hash.calculateContractAddressFromHash(PUBLIC_KEY, classHash, [PUBLIC_KEY], 0);
  return {
    accountContractType: "openzeppelin",
    address,
    classHash,
    derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_SEPOLIA:${address}`,
    networkId: "SN_SEPOLIA",
    publicKeyX: PUBLIC_KEY,
    publicKeyY: "0x2",
  };
};

/** An undeployed Argent account (salt = public key, no guardian) at `classHash`. */
export const argentAccountAt = (classHash: string): AccountRef => {
  const address = hash.calculateContractAddressFromHash(
    PUBLIC_KEY,
    classHash,
    [...argentAccountConstructorCalldata(PUBLIC_KEY)],
    0,
  );
  return {
    accountContractType: "argent",
    address,
    classHash,
    deploymentSalt: PUBLIC_KEY,
    derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
    id: `SN_SEPOLIA:${address}`,
    networkId: "SN_SEPOLIA",
    publicKeyX: PUBLIC_KEY,
    publicKeyY: "0x2",
  };
};

/** Undeployed Argent 0.4.0 and Xverse Argent 0.4.0 accounts, both sponsorable. */
export const argentAccount = argentAccountAt(ARGENT_ACCOUNT_CLASS_HASH);
export const xverseAccount = argentAccountAt(XVERSE_ARGENT_CLASS_HASH);

// The one relay the suites turn on.
const SPONSOR_RELAY = { SN_SEPOLIA: { url: "https://gateway.test/sponsor" } };

/** An undeployed OpenZeppelin 3.0 account whose deployment data reproduces its address. */
export const ozAccount: AccountRef = ozAccountAt(OPENZEPPELIN_ACCOUNT_CLASS_HASH);

/** The same keys as a Braavos account, which the sponsored route refuses. */
export const braavosAccount: AccountRef = {
  ...ozAccount,
  accountContractType: "braavos",
  classHash: BRAAVOS_DEPLOYMENT_CLASS_HASH,
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

/**
 * What the chain answers for the account; tests may flip it. `classHash` is
 * the class a deployed address runs, the account's own unless set.
 */
export type Chain = { classHash?: string; deployed: boolean | Error };

/** Handler deps over the doubles above; shared `pending`/`activity` survive a "restart". */
export const sponsoredHarness = async (input: {
  readonly account?: AccountRef;
  readonly activity?: ActivityLog;
  readonly balance?: string;
  readonly chain?: Chain;
  readonly deployed?: boolean | Error;
  readonly pending?: PendingDeployments;
  readonly relay?: Relay;
  /**
   * "off" names no relay for any network; "bundled" leaves the production
   * table and transport (`fetch`) in place. Default: the test relay on Sepolia.
   */
  readonly relayOn?: "bundled" | "off";
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
    async verifyAccountClassHash({ expectedClassHash }) {
      if (chain.deployed instanceof Error) throw chain.deployed;
      if (!chain.deployed) return { status: "undeployed" as const };
      const onChainClassHash = chain.classHash ?? expectedClassHash;
      return onChainClassHash === expectedClassHash
        ? { onChainClassHash, status: "verified" as const }
        : { expectedClassHash, onChainClassHash, status: "mismatch" as const };
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
    ...(input.relayOn === "bundled"
      ? {}
      : {
          sponsoredDeploy: {
            ...(input.relay ? { http: input.relay.http } : {}),
            networks: input.relayOn === "off" ? {} : SPONSOR_RELAY,
          },
        }),
    wallet: createWallet({ accounts: [account], activeAccountId: () => account.id }),
  };
  return { activity, chain, deps, pending, preferencesStore, runtimeRpc, session };
};
