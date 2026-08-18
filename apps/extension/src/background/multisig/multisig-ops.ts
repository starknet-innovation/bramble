/**
 * Privileged Argent multisig registry and fresh chain-config operations.
 */
import type { ArgentMultisigConfig } from "@mc-wallet/multisig/chain";
import type {
  ArgentMultisigConfigSnapshot,
  ArgentMultisigRecord,
  MultisigStore,
} from "@mc-wallet/multisig/repository";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentSignerGuid,
  normalizeArgentMultisigConfig,
} from "@mc-wallet/starknet/account-contracts";
import { isContractNotFoundError } from "@mc-wallet/starknet/provider";
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
  matchesArgentPublicConfig,
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
  if (!isAuthorized()) return { record, result: "unauthorized" };
  if (!existing) return { record, result: await store.upsertMultisig(record, isAuthorized) };
  if (!record.currentConfig) return { record: existing, result: "stored" };
  const expected = storedArgentPublicConfig(existing);
  if (!expected) {
    const result = await store.upsertMultisig(record, isAuthorized);
    return { record: result === "stored" ? record : existing, result };
  }
  const returned = { ...existing, currentConfig: record.currentConfig };
  const result = await store.updateCurrentConfig(
    existing.id,
    expected,
    record.currentConfig,
    isAuthorized,
  );
  return { record: returned, result };
};

const readDeployedConfig = async (
  deps: MultisigOpsDeps,
  address: string,
  rpcUrls: readonly string[],
): Promise<ArgentMultisigConfig | null> => {
  try {
    return await multisigRpc(deps).getConfig({ address, rpcUrls });
  } catch (error) {
    if (isContractNotFoundError(error)) return null;
    throw error;
  }
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
  const preferences = await deps.preferencesStore.read();
  const config = await readDeployedConfig(
    deps,
    input.address,
    networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences),
  );
  if (!config) {
    return input.signerPublicKeys
      ? { error: "Signer keys cannot be verified until the multisig is deployed" }
      : { authorized, config, signerPublicKeys: [] };
  }
  let signerPublicKeys: readonly string[];
  try {
    signerPublicKeys = input.signerPublicKeys
      ? normalizeArgentMultisigConfig({
          signerPublicKeys: input.signerPublicKeys,
          threshold: config.threshold,
        }).signerPublicKeys
      : config.signerGuids
          .map(
            (guid) =>
              active.accounts.find(
                (account) =>
                  account.networkId === input.networkId &&
                  sameFelt(argentSignerGuid(account.publicKeyX), guid),
              )?.publicKeyX,
          )
          .filter((publicKey): publicKey is string => publicKey !== undefined);
  } catch {
    return { error: "Signer public keys are invalid or duplicated" };
  }
  if (
    input.signerPublicKeys &&
    (signerPublicKeys.length !== config.signerGuids.length ||
      signerPublicKeys.some(
        (publicKey, index) =>
          !sameFelt(argentSignerGuid(publicKey), config.signerGuids[index] ?? ""),
      ))
  ) {
    return { error: "Signer public keys do not match the current on-chain authority" };
  }
  return { authorized, config, signerPublicKeys };
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
 * Reads the fresh signer authority for one pinned Argent multisig.
 */
export const currentChainConfigFor = async (
  deps: MultisigOpsDeps,
  context: Pick<ArgentMultisigContext, "record" | "rpcUrls">,
): Promise<ArgentMultisigConfig> =>
  multisigRpc(deps).getConfig({
    address: context.record.address,
    rpcUrls: context.rpcUrls,
  });

/**
 * Requires fresh chain authority to match the public keys retained by this
 * wallet. Preparation and signer-management review must not guess those keys.
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
  const chain = await currentChainConfigFor(deps, context);
  if (!matchesArgentPublicConfig(current, chain)) {
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
        const config = await readDeployedConfig(deps, record.address, rpcUrls);
        if (!config) return { config: null, deployed: false, record };
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
    ...(context.config && context.signerPublicKeys.length === context.config.signerGuids.length
      ? {
          currentConfig: {
            signerPublicKeys: context.signerPublicKeys,
            threshold: context.config.threshold,
          },
        }
      : {}),
    id: `${input.networkId}:${address}`,
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
        multisig: {
          config: context.config,
          deployed: context.config !== null,
          record: stored.record,
        },
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
  const config = await readDeployedConfig(deps, context.record.address, context.rpcUrls);
  const intents = (await deps.multisigStore.listIntents()).filter(
    (intent) => intent.accountId === context.record.id,
  );
  if (!config) {
    return {
      intents,
      multisig: { config: null, deployed: false, record: context.record },
      ok: true,
    };
  }
  const refreshed = await reconcileArgentCurrentConfig(deps, context.record, config);
  await markObservedArgentIntentOutcomes(deps, refreshed);
  await markChangedIntentsStale(deps.multisigStore, context.record.id, config);
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
