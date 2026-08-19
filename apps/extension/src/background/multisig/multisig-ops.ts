/**
 * Privileged Argent multisig registry and authority operations.
 */
import type {
  ArgentMultisigAuthorityStatus,
  ArgentMultisigConfig,
  ArgentUnsupportedSigner,
} from "@mc-wallet/multisig/chain";
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
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@mc-wallet/wallet-model/networks";
import {
  type ActiveAccountContext,
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { handleMultisigAccountOps } from "./multisig-account-ops";
import {
  discoverArgentSigners,
  enrichArgentAddressOnlyWatch,
  markChangedIntentsStale,
  markObservedArgentIntentOutcomes,
  matchesArgentPublicConfig,
  reconcileArgentCurrentConfig,
  storedArgentPublicConfig,
} from "./multisig-config-reconcile";
import { type ArgentMultisigContext, contextFor } from "./multisig-context";
import { handleMultisigDeployOps } from "./multisig-deploy-ops";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import {
  type AddArgentMultisigInput,
  readAddMultisigInput,
  readMultisigIdInput,
  readMultisigsInput,
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

const readAuthority = async (
  deps: MultisigOpsDeps,
  address: string,
  rpcUrls: readonly string[],
): Promise<{
  readonly config: ArgentMultisigConfig | null;
  readonly status: ArgentMultisigAuthorityStatus;
}> => {
  try {
    return {
      config: await multisigRpc(deps).getConfig({ address, rpcUrls }),
      status: "available",
    };
  } catch (error) {
    if (isContractNotFoundError(error)) return { config: null, status: "undeployed" };
    const message = error instanceof Error ? error.message : "";
    if (message === "Account is not the pinned Argent Multisig 0.2 class") {
      return { config: null, status: "unsupported-class" };
    }
    if (/^Invalid Argent multisig/.test(message)) {
      return { config: null, status: "invalid-config" };
    }
    return { config: null, status: "network-unavailable" };
  }
};

const unavailableAddError = (status: ArgentMultisigAuthorityStatus): string =>
  ({
    available: "Argent multisig authority could not be verified",
    "invalid-config": "This Argent multisig returned an invalid signer configuration",
    "network-unavailable":
      "Argent multisig authority could not be verified. Check the network and retry",
    undeployed: "Signer keys cannot be verified until the multisig is deployed",
    "unsupported-class": "This address is not the pinned Argent Multisig 0.2 account",
    "unsupported-signers": "This Argent multisig uses unsupported signer types",
  })[status];

const signersForAdd = async (
  deps: MultisigOpsDeps,
  active: ActiveAccountContext & { readonly error?: never },
  preferences: Awaited<ReturnType<MultisigOpsDeps["preferencesStore"]["read"]>>,
  input: AddArgentMultisigInput,
  config: ArgentMultisigConfig,
  rpcUrls: readonly string[],
): Promise<{
  readonly signerPublicKeys: readonly string[];
  readonly unsupportedSigners: readonly ArgentUnsupportedSigner[];
} | null> => {
  try {
    return input.signerPublicKeys
      ? {
          signerPublicKeys: normalizeArgentMultisigConfig({
            signerPublicKeys: input.signerPublicKeys,
            threshold: config.threshold,
          }).signerPublicKeys,
          unsupportedSigners: [],
        }
      : await discoverArgentSigners(deps, active, preferences, input.address, config, rpcUrls);
  } catch {
    return null;
  }
};

const addWithoutConfig = (
  status: ArgentMultisigAuthorityStatus,
  input: AddArgentMultisigInput,
  authorized: ReturnType<typeof captureSessionAuthorization>,
) => {
  if (status !== "undeployed") return { error: unavailableAddError(status) };
  if (input.signerPublicKeys) {
    return { error: "Signer keys cannot be verified until the multisig is deployed" };
  }
  return {
    authorityStatus: status,
    authorized,
    config: null,
    signerPublicKeys: [],
    unsupportedSigners: [],
  } as const;
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
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences);
  const authority = await readAuthority(deps, input.address, rpcUrls);
  const config = authority.config;
  if (!config) return addWithoutConfig(authority.status, input, authorized);
  const discovered = await signersForAdd(deps, active, preferences, input, config, rpcUrls);
  if (!discovered) {
    return { error: "Signer public keys are invalid or duplicated" };
  }
  const { signerPublicKeys, unsupportedSigners } = discovered;
  if (
    input.signerPublicKeys &&
    !matchesArgentPublicConfig({ signerPublicKeys, threshold: config.threshold }, config)
  ) {
    return { error: "A supplied public key is not a current Stark signer for this multisig" };
  }
  return {
    authorityStatus: unsupportedSigners.length > 0 ? "unsupported-signers" : authority.status,
    authorized,
    config,
    signerPublicKeys,
    unsupportedSigners,
  };
};

/**
 * Fresh, non-persisted view returned to the wallet UI.
 */
type ArgentMultisigView = {
  readonly authorityStatus: ArgentMultisigAuthorityStatus;
  readonly config: ArgentMultisigConfig | null;
  readonly deployed: boolean | null;
  readonly record: ArgentMultisigRecord;
  readonly unsupportedSigners: readonly ArgentUnsupportedSigner[];
};

/**
 * Re-exports the fail-closed active-network context used by transaction
 * operations. It contains no signer secret material.
 */
export type { ArgentMultisigContext } from "./multisig-context";

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

const storedMultisigView = (record: ArgentMultisigRecord): ArgentMultisigView => {
  const stored = storedArgentPublicConfig(record);
  return {
    authorityStatus: record.currentConfig
      ? "available"
      : record.deployment
        ? "undeployed"
        : "network-unavailable",
    config: stored
      ? {
          classHash: record.classHash,
          signerGuids: stored.signerPublicKeys.map(argentSignerGuid),
          threshold: stored.threshold,
        }
      : null,
    deployed: record.currentConfig ? true : record.deployment ? false : null,
    record,
    unsupportedSigners: [],
  };
};

const listMultisigs = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readMultisigsInput(message);
  if (!input) return { error: "invalid Argent multisig list request" };
  const active = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (active.error !== undefined) return { error: active.error };
  const preferences = await deps.preferencesStore.read();
  const records = (await deps.multisigStore.listMultisigs()).filter(
    (record) => record.networkId === active.networkId,
  );
  const accountIds = new Set(records.map((record) => record.id));
  const intents = (await deps.multisigStore.listIntents()).filter((intent) =>
    accountIds.has(intent.accountId),
  );
  if (input.cached) {
    return { intents, multisigs: records.map(storedMultisigView), ok: true };
  }
  const multisigs: ArgentMultisigView[] = await Promise.all(
    records.map(async (record) => {
      if (record.currentConfig) {
        await markObservedArgentIntentOutcomes(deps, record);
        return storedMultisigView(record);
      }
      const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences);
      const authority = await readAuthority(deps, record.address, rpcUrls);
      const config = authority.config;
      if (!config) {
        return {
          authorityStatus: authority.status,
          config: null,
          deployed: authority.status === "undeployed" ? false : null,
          record,
          unsupportedSigners: [],
        };
      }
      try {
        const reconciled = await reconcileArgentCurrentConfig(deps, record, config);
        const refreshed = await enrichArgentAddressOnlyWatch(
          deps,
          active,
          preferences,
          reconciled,
          config,
          rpcUrls,
        );
        await markObservedArgentIntentOutcomes(deps, refreshed.record);
        await markChangedIntentsStale(deps.multisigStore, record.id, config);
        return {
          authorityStatus:
            refreshed.unsupportedSigners.length > 0 ? "unsupported-signers" : "available",
          config,
          deployed: true,
          record: refreshed.record,
          unsupportedSigners: refreshed.unsupportedSigners,
        };
      } catch {
        return {
          authorityStatus: "available",
          config,
          deployed: true,
          record,
          unsupportedSigners: [],
        };
      }
    }),
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
          authorityStatus: context.authorityStatus,
          config: context.config,
          deployed: context.config !== null,
          record: stored.record,
          unsupportedSigners: context.unsupportedSigners,
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
  const authority = await readAuthority(deps, context.record.address, context.rpcUrls);
  const config = authority.config;
  if (!config) {
    const intents = (await deps.multisigStore.listIntents()).filter(
      (intent) => intent.accountId === context.record.id,
    );
    return {
      intents,
      multisig: {
        authorityStatus: authority.status,
        config: null,
        deployed: authority.status === "undeployed" ? false : null,
        record: context.record,
        unsupportedSigners: [],
      },
      ok: true,
    };
  }
  const reconciled = await reconcileArgentCurrentConfig(deps, context.record, config);
  const refreshed = await enrichArgentAddressOnlyWatch(
    deps,
    context.active,
    await deps.preferencesStore.read(),
    reconciled,
    config,
    context.rpcUrls,
  );
  await markObservedArgentIntentOutcomes(deps, refreshed.record);
  await markChangedIntentsStale(deps.multisigStore, context.record.id, config);
  const intents = (await deps.multisigStore.listIntents()).filter(
    (intent) => intent.accountId === context.record.id,
  );
  return {
    intents,
    multisig: {
      authorityStatus:
        refreshed.unsupportedSigners.length > 0 ? "unsupported-signers" : "available",
      config,
      deployed: true,
      record: refreshed.record,
      unsupportedSigners: refreshed.unsupportedSigners,
    },
    ok: true,
  };
};

type RegistryHandler = (deps: MultisigOpsDeps, message: unknown) => Promise<RuntimeResponse>;
const HANDLERS: Readonly<Record<string, RegistryHandler>> = {
  "wallet.addMultisig": addMultisig,
  "wallet.multisigs": listMultisigs,
  "wallet.refreshMultisig": refreshMultisig,
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
  return (
    handleMultisigAccountOps(deps, messageType, message) ??
    handleMultisigDeployOps(deps, messageType, message)
  );
};
