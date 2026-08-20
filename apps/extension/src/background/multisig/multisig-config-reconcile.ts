/**
 * Accepted-chain reconciliation for mutable Argent signer configuration.
 */
import {
  type ArgentMultisigConfig,
  type ArgentMultisigConfigChange,
  type ArgentMultisigPublicConfig,
  type ArgentUnsupportedSigner,
  nextArgentMultisigPublicConfig,
  parseArgentMultisigConfigChange,
} from "@mc-wallet/multisig/chain";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
  MultisigStore,
} from "@mc-wallet/multisig/repository";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { type StarknetNetworkId, sameFelt } from "@mc-wallet/wallet-model/networks";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";

/**
 * Compares already-canonical ordered signer GUIDs. Untrusted aliases fail by
 * inequality; this pure comparison never throws or normalizes authority.
 */
const sameArgentSignerGuids = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * Returns the last observed config, falling back to a legacy deployment.
 */
export const storedArgentPublicConfig = (
  record: ArgentMultisigRecord,
): ArgentMultisigPublicConfig | null => record.currentConfig ?? record.deployment ?? null;

/**
 * Checks whether retained public signer keys match one fresh on-chain GUID view.
 */
export const matchesArgentPublicConfig = (
  current: ArgentMultisigPublicConfig,
  chain: ArgentMultisigConfig,
): boolean =>
  current.threshold === chain.threshold &&
  sameArgentSignerGuids(current.signerPublicKeys.map(argentSignerGuid), chain.signerGuids);

/**
 * Marks open intents stale when their frozen authority no longer matches.
 */
export const markChangedIntentsStale = async (
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

type SignerDiscoveryContext = {
  readonly accounts: readonly AccountRef[];
  readonly networkId: StarknetNetworkId;
};

/**
 * Resolves current signer keys from accepted linked events, local accounts,
 * and address-book contacts, preserving fresh on-chain GUID order.
 */
export const discoverArgentSigners = async (
  deps: MultisigOpsDeps,
  active: SignerDiscoveryContext,
  preferences: WalletPreferences,
  address: string,
  config: ArgentMultisigConfig,
  rpcUrls: readonly string[],
): Promise<{
  readonly signerPublicKeys: readonly string[];
  readonly unsupportedSigners: readonly ArgentUnsupportedSigner[];
}> => {
  let linked: readonly string[] = [];
  let unsupportedSigners: readonly ArgentUnsupportedSigner[] = [];
  try {
    const discovered = (await multisigRpc(deps).getSignerPublicKeys?.({
      address,
      rpcUrls,
      signerGuids: config.signerGuids,
    })) ?? { signerPublicKeys: [], unsupportedSigners: [] };
    linked = discovered.signerPublicKeys;
    unsupportedSigners = discovered.unsupportedSigners;
  } catch {
    // A watched address remains useful when historical RPC reads are unavailable.
  }
  const candidates = [
    ...linked,
    ...active.accounts
      .filter((account) => account.networkId === active.networkId)
      .map((account) => account.publicKeyX),
    ...preferences.addressBook
      .filter((contact) => contact.networkId === active.networkId)
      .flatMap((contact) => (contact.publicKeyX === undefined ? [] : [contact.publicKeyX])),
  ];
  return {
    signerPublicKeys: config.signerGuids
      .filter((guid) => !unsupportedSigners.some((unsupported) => sameFelt(unsupported.guid, guid)))
      .map((guid) => candidates.find((publicKey) => sameFelt(argentSignerGuid(publicKey), guid)))
      .filter((publicKey): publicKey is string => publicKey !== undefined),
    unsupportedSigners,
  };
};

/**
 * Persists a complete discovered config for an address-only watch.
 */
export const enrichArgentAddressOnlyWatch = async (
  deps: MultisigOpsDeps,
  active: SignerDiscoveryContext,
  preferences: WalletPreferences,
  record: ArgentMultisigRecord,
  config: ArgentMultisigConfig,
  rpcUrls: readonly string[],
): Promise<{
  readonly record: ArgentMultisigRecord;
  readonly unsupportedSigners: readonly ArgentUnsupportedSigner[];
}> => {
  const stored = storedArgentPublicConfig(record);
  if (stored && matchesArgentPublicConfig(stored, config)) {
    if (record.currentConfig) return { record, unsupportedSigners: [] };
    const observed = {
      ...record,
      currentConfig: {
        signerPublicKeys: stored.signerPublicKeys,
        threshold: stored.threshold,
      },
    };
    return {
      record: (await deps.multisigStore.upsertMultisig(observed)) === "stored" ? observed : record,
      unsupportedSigners: [],
    };
  }
  const discovered = await discoverArgentSigners(
    deps,
    active,
    preferences,
    record.address,
    config,
    rpcUrls,
  );
  if (stored) {
    return { record, unsupportedSigners: discovered.unsupportedSigners };
  }
  if (discovered.signerPublicKeys.length !== config.signerGuids.length) {
    return { record, unsupportedSigners: discovered.unsupportedSigners };
  }
  const enriched = {
    ...record,
    currentConfig: { signerPublicKeys: discovered.signerPublicKeys, threshold: config.threshold },
  };
  return {
    record: (await deps.multisigStore.upsertMultisig(enriched)) === "stored" ? enriched : record,
    unsupportedSigners: discovered.unsupportedSigners,
  };
};

type ConfigCandidate = {
  readonly change: ArgentMultisigConfigChange;
  readonly intent: ArgentMultisigSigningIntent;
  readonly nonce: bigint;
};

const matchingCandidateSuffix = (
  current: ArgentMultisigPublicConfig,
  chain: ArgentMultisigConfig,
  candidates: readonly ConfigCandidate[],
): {
  readonly applied: readonly ConfigCandidate[];
  readonly next: ArgentMultisigPublicConfig;
} | null => {
  for (let start = candidates.length - 1; start >= 0; start -= 1) {
    try {
      let next = current;
      const applied = candidates.slice(start);
      for (const candidate of applied)
        next = nextArgentMultisigPublicConfig(next, candidate.change);
      if (matchesArgentPublicConfig(next, chain)) return { applied, next };
    } catch {
      // An already-applied prefix may no longer be valid against `current`.
    }
  }
  return null;
};

/**
 * Advances public keys only from observed config intents whose
 * accepted activity and deterministic result exactly match fresh chain state.
 */
export const reconcileArgentCurrentConfig = async (
  deps: MultisigOpsDeps,
  record: ArgentMultisigRecord,
  chain: ArgentMultisigConfig,
): Promise<ArgentMultisigRecord> => {
  const current = storedArgentPublicConfig(record);
  if (!current || matchesArgentPublicConfig(current, chain)) return record;
  const accepted = new Set(
    (await deps.activity.list())
      .filter(
        (entry) =>
          entry.accountId === record.id &&
          entry.networkId === record.networkId &&
          entry.status === "accepted",
      )
      .map((entry) => entry.hash),
  );
  const candidates = (await deps.multisigStore.listIntents())
    .filter(
      (intent) =>
        intent.accountId === record.id &&
        (intent.state === "submitted" || intent.state === "accepted") &&
        intent.broadcastTransactionHash !== undefined &&
        [...accepted.keys()].some((hash) => sameFelt(hash, intent.broadcastTransactionHash)),
    )
    .map((intent) => {
      const call = intent.prepared.calls[0];
      if (intent.prepared.calls.length !== 1 || !call) return null;
      try {
        return {
          change: parseArgentMultisigConfigChange(record.address, call),
          intent,
          nonce: BigInt(intent.prepared.nonce),
        };
      } catch {
        return null;
      }
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => (left.nonce < right.nonce ? -1 : left.nonce > right.nonce ? 1 : 0));
  if (
    candidates.some((candidate, index) => {
      const prior = candidates[index - 1];
      return prior ? candidate.nonce <= prior.nonce : false;
    })
  ) {
    return record;
  }
  const match = matchingCandidateSuffix(current, chain, candidates);
  if (!match) return record;
  const { applied, next } = match;
  if ((await deps.multisigStore.updateCurrentConfig(record.id, current, next)) !== "stored") {
    return record;
  }
  for (const candidate of applied) {
    if (candidate.intent.state === "submitted") {
      await deps.multisigStore.upsertIntent({ ...candidate.intent, state: "accepted" });
    }
  }
  return { ...record, currentConfig: next };
};

/**
 * Applies terminal activity observations to already submitted intents.
 */
export const markObservedArgentIntentOutcomes = async (
  deps: MultisigOpsDeps,
  record: ArgentMultisigRecord,
): Promise<void> => {
  const activities = (await deps.activity.list()).filter(
    (entry) => entry.accountId === record.id && entry.networkId === record.networkId,
  );
  for (const intent of await deps.multisigStore.listIntents()) {
    if (intent.accountId !== record.id || intent.state !== "submitted") continue;
    const activity = activities.find(
      (entry) =>
        intent.broadcastTransactionHash !== undefined &&
        sameFelt(entry.hash, intent.broadcastTransactionHash),
    );
    if (activity?.status === "rejected" || activity?.status === "reverted") {
      await deps.multisigStore.upsertIntent({ ...intent, state: "rejected" });
    } else if (activity?.status === "accepted") {
      await deps.multisigStore.upsertIntent({ ...intent, state: "accepted" });
    }
  }
};
