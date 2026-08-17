/**
 * Privileged Argent multisig registry and fresh chain-config operations.
 */
import type { ArgentMultisigConfig } from "@mc-wallet/multisig/chain";
import type {
  ArgentMultisigConfigSnapshot,
  ArgentMultisigRecord,
  MultisigStore,
} from "@mc-wallet/multisig/repository";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import type { TokenBalance } from "@mc-wallet/starknet/rpc";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import { readTypeOnlyInput } from "../routing/message-inputs";
import {
  type ActiveAccountContext,
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import {
  markObservedArgentIntentOutcomes,
  reconcileArgentCurrentConfig,
  sameArgentSignerGuids,
  storedArgentPublicConfig,
} from "./multisig-config-reconcile";
import { handleMultisigDeployOps } from "./multisig-deploy-ops";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import {
  type AddArgentMultisigInput,
  readAddMultisigInput,
  readMultisigIdInput,
  readRemoveMultisigInput,
} from "./multisig-inputs";

/**
 * Re-export the neutral composition dependency seam.
 */
export type { MultisigOpsDeps } from "./multisig-deps";

const addRecord = async (
  store: MultisigStore,
  record: ArgentMultisigRecord,
  isAuthorized: () => boolean,
): Promise<{
  readonly record: ArgentMultisigRecord;
  readonly result: Awaited<ReturnType<MultisigStore["upsertMultisig"]>>;
}> => {
  const existing = (await store.listMultisigs()).find((candidate) => candidate.id === record.id);
  if (!existing) return { record, result: await store.upsertMultisig(record, isAuthorized) };
  const expected = storedArgentPublicConfig(existing);
  if (!expected || !record.currentConfig) return { record, result: "invalid" };
  const returned = { ...existing, currentConfig: record.currentConfig };
  const result = await store.updateCurrentConfig(
    existing.id,
    expected,
    record.currentConfig,
    isAuthorized,
  );
  return { record: returned, result };
};

const addChainContext = async (deps: MultisigOpsDeps, input: AddArgentMultisigInput) => {
  const authorized = captureSessionAuthorization(deps.session);
  const active = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined || !authorized.isCurrent()) {
    return { error: active.error ?? "wallet locked" } as const;
  }
  if (active.networkId !== input.networkId) {
    return { error: "switch to the multisig network first" } as const;
  }
  const signer = active.accounts.find(
    (account) => account.id === input.signerAccountId && account.networkId === input.networkId,
  );
  if (!signer) {
    return { error: "selected signer account is unavailable on this network" } as const;
  }
  const preferences = await deps.preferencesStore.read();
  const config = await multisigRpc(deps).getConfig({
    address: input.address,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences),
  });
  const matches =
    config.signerGuids.includes(argentSignerGuid(signer.publicKeyX)) &&
    config.threshold === input.threshold &&
    sameArgentSignerGuids(config.signerGuids, input.signerPublicKeys.map(argentSignerGuid));
  return matches
    ? { authorized, config }
    : { error: "Argent multisig current config or selected signer does not match chain state" };
};

/**
 * Fresh, non-persisted view returned to the wallet UI.
 */
type ArgentMultisigView = {
  readonly config: ArgentMultisigConfig | null;
  readonly deployed: boolean | null;
  readonly record: ArgentMultisigRecord;
};

/**
 * Resolved watched account and active-network RPC scope.
 */
export type ArgentMultisigContext = {
  readonly active: ActiveAccountContext & { readonly error?: never };
  readonly record: ArgentMultisigRecord;
  readonly rpcUrls: readonly string[];
};

const contextFor = async (
  deps: MultisigOpsDeps,
  active: ActiveAccountContext,
  multisigId: string,
): Promise<ArgentMultisigContext | { readonly error: string }> => {
  if (active.error !== undefined) {
    return { error: active.error };
  }
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === multisigId,
  );
  if (!record) {
    return { error: "Argent multisig not found" };
  }
  if (record.networkId !== active.networkId) {
    return { error: "switch to the multisig network first" };
  }
  const preferences = await deps.preferencesStore.read();
  return {
    active,
    record,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
  };
};

/**
 * Resolves one explicit single-signer wallet account inside a context.
 */
export const signerAccountFor = (
  context: ArgentMultisigContext,
  signerAccountId: string,
): AccountRef | null =>
  context.active.accounts.find(
    (account) => account.id === signerAccountId && account.networkId === context.record.networkId,
  ) ?? null;

/**
 * Converts a fresh chain view into the immutable intent snapshot shape.
 */
export const configSnapshot = (config: ArgentMultisigConfig): ArgentMultisigConfigSnapshot => ({
  classHash: config.classHash,
  signerGuids: config.signerGuids,
  threshold: config.threshold,
});

/**
 * Requires fresh chain authority to match the constructor public keys retained
 * by this wallet. Signer GUIDs are one-way, so a changed signer set cannot be
 * safely prepared until its public keys are imported through a future config
 * package rather than guessed locally.
 */
export const currentConfigFor = async (
  deps: MultisigOpsDeps,
  context: Pick<ArgentMultisigContext, "record" | "rpcUrls">,
): Promise<{
  readonly chain: ArgentMultisigConfig;
  readonly signerPublicKeys: readonly string[];
  readonly threshold: number;
}> => {
  const current = storedArgentPublicConfig(context.record);
  if (!current) {
    throw new Error("Argent multisig public signer configuration is unavailable");
  }
  const chain = await multisigRpc(deps).getConfig({
    address: context.record.address,
    rpcUrls: context.rpcUrls,
  });
  const guids = current.signerPublicKeys.map(argentSignerGuid);
  if (chain.threshold !== current.threshold || !sameArgentSignerGuids(chain.signerGuids, guids)) {
    throw new Error("Argent multisig signer configuration changed on-chain");
  }
  return {
    chain,
    signerPublicKeys: current.signerPublicKeys,
    threshold: current.threshold,
  };
};

const markChangedIntentsStale = async (
  store: MultisigStore,
  accountId: string,
  config: ArgentMultisigConfig,
): Promise<void> => {
  for (const intent of await store.listIntents()) {
    if (
      intent.accountId === accountId &&
      (intent.state === "collecting" || intent.state === "ready") &&
      (intent.configSnapshot.threshold !== config.threshold ||
        !sameArgentSignerGuids(intent.configSnapshot.signerGuids, config.signerGuids))
    ) {
      await store.upsertIntent({ ...intent, state: "stale" });
    }
  }
};

const listMultisigs = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.multisigs")) {
    return { error: "invalid Argent multisig list request" };
  }
  const active = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined) {
    return { error: active.error };
  }
  const preferences = await deps.preferencesStore.read();
  const records = (await deps.multisigStore.listMultisigs()).filter(
    (record) => record.networkId === active.networkId,
  );
  const multisigs: ArgentMultisigView[] = await Promise.all(
    records.map(async (record) => {
      const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences);
      try {
        const config = await multisigRpc(deps).getConfig({
          address: record.address,
          rpcUrls,
        });
        const refreshed = await reconcileArgentCurrentConfig(deps, record, config);
        await markObservedArgentIntentOutcomes(deps, refreshed);
        await markChangedIntentsStale(deps.multisigStore, record.id, config);
        return { config, deployed: true, record: refreshed };
      } catch {
        const deployed = await deps.runtimeRpc
          .getDeploymentStatus({ accountAddress: record.address, rpcUrls })
          .catch(() => null);
        return { config: null, deployed, record };
      }
    }),
  );
  const accountIds = new Set(records.map((record) => record.id));
  const intents = (await deps.multisigStore.listIntents()).filter((intent) =>
    accountIds.has(intent.accountId),
  );
  return { intents, multisigs, ok: true };
};

const addMultisig = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readAddMultisigInput(message);
  if (!input) {
    return { error: "invalid Argent multisig add request" };
  }
  const context = await addChainContext(deps, input);
  if (context.error !== undefined) return { error: context.error };
  const address = input.address;
  const record: ArgentMultisigRecord = {
    accountContractType: "argent-multisig",
    address,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    currentConfig: {
      signerPublicKeys: input.signerPublicKeys,
      threshold: input.threshold,
    },
    id: `${input.networkId}:${address}`,
    ...(input.name === undefined ? {} : { name: input.name }),
    networkId: input.networkId,
  };
  if (!context.authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  const stored = await addRecord(deps.multisigStore, record, context.authorized.isCurrent);
  if (stored.result === "unauthorized") return { error: "wallet locked" };
  return stored.result === "stored"
    ? {
        intents: [],
        multisig: { config: context.config, deployed: true, record: stored.record },
        ok: true,
      }
    : { error: `Argent multisig registry ${stored.result}` };
};

const refreshMultisig = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readMultisigIdInput(message, "wallet.refreshMultisig");
  if (!input) {
    return { error: "invalid Argent multisig refresh request" };
  }
  const context = await contextFor(
    deps,
    await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    input.multisigId,
  );
  if ("error" in context) {
    return context;
  }
  const config = await multisigRpc(deps).getConfig({
    address: context.record.address,
    rpcUrls: context.rpcUrls,
  });
  const refreshed = await reconcileArgentCurrentConfig(deps, context.record, config);
  await markObservedArgentIntentOutcomes(deps, refreshed);
  await markChangedIntentsStale(deps.multisigStore, context.record.id, config);
  const intents = (await deps.multisigStore.listIntents()).filter(
    (intent) => intent.accountId === context.record.id,
  );
  return { intents, multisig: { config, deployed: true, record: refreshed }, ok: true };
};

const removeMultisig = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readRemoveMultisigInput(message);
  if (!input) {
    return { error: "invalid Argent multisig removal request" };
  }
  const authorized = captureSessionAuthorization(deps.session);
  const context = await contextFor(
    deps,
    await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    input.multisigId,
  );
  if ("error" in context || !authorized.isCurrent()) {
    return "error" in context ? context : { error: "wallet locked" };
  }
  const intents = (await deps.multisigStore.listIntents()).filter(
    (intent) => intent.accountId === context.record.id,
  );
  const operations = (await deps.multisigStore.listOperations()).filter(
    (operation) => operation.accountId === context.record.id,
  );
  const terminalIntentHashes = intents
    .filter(
      (intent) => !(["collecting", "ready", "submitted"] as const).includes(intent.state as never),
    )
    .map((intent) => intent.prepared.transactionHash);
  if (
    intents.some((intent) =>
      (["collecting", "ready", "submitted"] as const).includes(intent.state as never),
    ) ||
    operations.some(
      (operation) =>
        operation.transactionHash === undefined &&
        !(
          operation.kind === "sign" &&
          terminalIntentHashes.some((hash) => sameFelt(hash, operation.target))
        ),
    )
  ) {
    return { error: "Argent multisig has a pending or unresolved operation" };
  }
  if ((intents.length > 0 || operations.length > 0) && !input.confirmHistoryRemoval) {
    return { error: "confirm removal of terminal Argent multisig history" };
  }
  if (!authorized.isCurrent()) {
    return { error: "wallet locked" };
  }
  return (await deps.multisigStore.removeMultisig(context.record.id, authorized.isCurrent)) ===
    "removed"
    ? { ok: true }
    : { error: "wallet locked" };
};

const multisigBalances = async (
  deps: MultisigOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readMultisigIdInput(message, "wallet.multisigBalances");
  if (!input) {
    return { error: "invalid Argent multisig balances request" };
  }
  const context = await contextFor(
    deps,
    await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore),
    input.multisigId,
  );
  if ("error" in context) {
    return context;
  }
  const balances: readonly TokenBalance[] = await deps.runtimeRpc.getTokenBalances({
    accountAddress: context.record.address,
    rpcUrls: context.rpcUrls,
    tokens: (await deps.preferencesStore.read()).tokens.filter(
      (token) => token.networkId === context.record.networkId,
    ),
  });
  return {
    accountId: context.record.id,
    balances,
    networkId: context.record.networkId,
    ok: true,
  };
};

type RegistryHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;
const HANDLERS: Readonly<Record<string, RegistryHandler>> = {
  "wallet.addMultisig": addMultisig,
  "wallet.multisigBalances": multisigBalances,
  "wallet.multisigs": listMultisigs,
  "wallet.refreshMultisig": refreshMultisig,
  "wallet.removeMultisig": removeMultisig,
};

/**
 * Dispatches privileged Argent registry, deployment, and read operations.
 */
export const handleMultisigOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(HANDLERS, messageType) ? HANDLERS[messageType] : undefined;
  if (handler) {
    return handler(deps, message);
  }
  return handleMultisigDeployOps(deps, messageType, message);
};
