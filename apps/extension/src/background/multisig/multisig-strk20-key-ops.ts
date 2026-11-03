/**
 * Shared STRK20 viewing key for an Argent multisig (#826). One owner creates
 * it. Co-owners receive it only as a Nostr gift wrap addressed to each of
 * them. Messages report whether this wallet holds the key, never the key.
 */

import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type { ArgentMultisigRecord } from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import type { NostrApplicationData } from "@bramble/vault/kms-port";
import {
  MULTISIG_STRK20_KEY_IDENTIFIER,
  readMultisigStrk20KeyPackage,
} from "@bramble/vault/multisig-strk20-key";
import { isAccountId } from "@bramble/wallet-model/accounts";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { isNostrPublicKey } from "@bramble/wallet-model/nostr";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";
import { networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { type MultisigOpsDeps, multisigRpc } from "./multisig-deps";
import {
  coordinationRecipients,
  coordinationRelayUrls,
  isCoordinationSigner,
  publishForRecipients,
} from "./multisig-nostr-publish";
import { nativeNostrRelayTransport } from "./nostr-relay";

const STATUS = "wallet.argentMultisigStrk20KeyStatus";
const CREATE = "wallet.createArgentMultisigStrk20Key";
const SHARE = "wallet.shareArgentMultisigStrk20Key";
const FORGET = "wallet.forgetArgentMultisigStrk20Key";

/** What one decrypted viewing-key wrap did to this wallet. */
export type Strk20KeyImport = {
  readonly final: boolean;
  /** Set only when the vault accepted, kept, or refused the offered key. */
  readonly strk20Key?: "conflict" | "held" | "stored";
};

const readMultisigId = (message: unknown, type: string): string | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["multisigId", "type"]) &&
  message["type"] === type &&
  isAccountId(message["multisigId"])
    ? message["multisigId"]
    : null;

const chainSignerGuids = async (
  deps: MultisigOpsDeps,
  record: ArgentMultisigRecord,
  preferences: WalletPreferences,
): Promise<readonly string[] | null> => {
  try {
    const config = await multisigRpc(deps).getConfig({
      address: record.address,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[record.networkId], preferences),
    });
    return config.signerGuids.length > 0 ? config.signerGuids : null;
  } catch {
    return null;
  }
};

const locked = (error: unknown): RuntimeResponse | null =>
  error instanceof WalletError && error.message === "wallet locked"
    ? { error: "wallet locked" }
    : null;

const scopeFor = async (
  deps: MultisigOpsDeps,
  multisigId: string,
): Promise<
  | { readonly error: string }
  | {
      readonly chainId: string;
      readonly poolAddress: string;
      readonly record: ArgentMultisigRecord;
    }
> => {
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === multisigId,
  );
  if (!record) return { error: "Argent multisig not found" };
  const preferences = await deps.preferencesStore.read();
  const configured = preferences.strk20Networks?.[record.networkId]?.poolAddress;
  const poolAddress = configured ? canonicalFelt(configured) : null;
  if (!poolAddress) {
    return { error: "Private balances are not configured for this network" };
  }
  return { chainId: STARKNET_NETWORKS[record.networkId].chainId, poolAddress, record };
};

const unlocked = (
  deps: MultisigOpsDeps,
): { readonly error: string } | { readonly passphrase: string } => {
  const passphrase = deps.session.getPassphrase();
  return passphrase ? { passphrase } : { error: "wallet locked" };
};

/**
 * Stores a co-owner's viewing key when the wrap is theirs to send. A malformed
 * wrap is finished. An unknown sender or a missing pool is left for a later
 * sync. A conflicting key is left too, so dropping the local key can accept it.
 * Returns null when the wrap is not a viewing key.
 */
export const importSharedStrk20Key = async (
  deps: MultisigOpsDeps,
  opened: NostrApplicationData,
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
  vaultPassphrase: string,
  isAuthorized: () => boolean,
): Promise<Strk20KeyImport | null> => {
  if (opened.identifier !== MULTISIG_STRK20_KEY_IDENTIFIER) return null;
  if (!isNostrPublicKey(opened.senderPublicKey)) return { final: true };
  const parsed = readMultisigStrk20KeyPackage(opened.content);
  if (!parsed) return { final: true };
  const record = records.find((candidate) => candidate.id === parsed.multisigId);
  if (!record || !sameFelt(parsed.chainId, STARKNET_NETWORKS[record.networkId].chainId)) {
    return { final: true };
  }
  const accept = deps.wallet.acceptMultisigStrk20Key;
  if (!accept || !isAuthorized()) return { final: false };
  const preferences = await deps.preferencesStore.read();
  const configured = preferences.strk20Networks?.[record.networkId]?.poolAddress;
  const poolAddress = configured ? canonicalFelt(configured) : null;
  const signers = await chainSignerGuids(deps, record, preferences);
  if (!poolAddress || poolAddress !== parsed.poolAddress || !signers) {
    return { final: false };
  }
  if (!isCoordinationSigner(contacts, opened.senderPublicKey, record.networkId, signers)) {
    return { final: false };
  }
  const result = await accept({
    chainId: parsed.chainId,
    isAuthorized,
    key: parsed.key,
    multisigId: parsed.multisigId,
    poolAddress: parsed.poolAddress,
    vaultPassphrase,
  });
  if (!isAuthorized()) return { final: false, strk20Key: result };
  return { final: result !== "conflict", strk20Key: result };
};

const status = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const multisigId = readMultisigId(message, STATUS);
  if (!multisigId) return { error: "invalid multisig key request" };
  const scope = await scopeFor(deps, multisigId);
  if ("error" in scope) return scope;
  const session = unlocked(deps);
  if ("error" in session) return session;
  const read = deps.wallet.multisigStrk20KeyStatus;
  if (!read) return { error: "Secure co-signer coordination is unavailable for this wallet" };
  const state = await read({
    chainId: scope.chainId,
    multisigId,
    poolAddress: scope.poolAddress,
    vaultPassphrase: session.passphrase,
  });
  return { ok: true, state };
};

const create = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const multisigId = readMultisigId(message, CREATE);
  if (!multisigId) return { error: "invalid multisig key request" };
  const scope = await scopeFor(deps, multisigId);
  if ("error" in scope) return scope;
  const session = unlocked(deps);
  if ("error" in session) return session;
  const authorized = captureSessionAuthorization(deps.session);
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const createKey = deps.wallet.createMultisigStrk20Key;
  if (!createKey) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  try {
    const state = await createKey({
      chainId: scope.chainId,
      isAuthorized: authorized.isCurrent,
      multisigId,
      poolAddress: scope.poolAddress,
      vaultPassphrase: session.passphrase,
    });
    return { ok: true, state };
  } catch (error) {
    const refusal = locked(error);
    if (refusal) return refusal;
    throw error;
  }
};

const share = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const multisigId = readMultisigId(message, SHARE);
  if (!multisigId) return { error: "invalid multisig key request" };
  if (!deps.wallet.nostrPublicKey || !deps.wallet.wrapNostrApplicationData) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  const scope = await scopeFor(deps, multisigId);
  if ("error" in scope) return scope;
  const preferences = await deps.preferencesStore.read();
  const guids = await chainSignerGuids(deps, scope.record, preferences);
  if (!guids) return { error: "This multisig's signers aren't available yet." };
  const session = unlocked(deps);
  if ("error" in session) return session;
  const authorized = captureSessionAuthorization(deps.session);
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const pack = deps.wallet.packageMultisigStrk20Key;
  if (!pack) return { error: "Secure co-signer coordination is unavailable for this wallet" };
  const content = await pack({
    chainId: scope.chainId,
    multisigId,
    poolAddress: scope.poolAddress,
    vaultPassphrase: session.passphrase,
  });
  if (!content) return { error: "Create a key before sharing it." };
  const ownPublicKey = await deps.wallet.nostrPublicKey(session.passphrase);
  const recipients = coordinationRecipients(
    preferences.addressBook,
    scope.record.networkId,
    ownPublicKey,
    guids,
  );
  if (recipients.length === 0) {
    return { error: "Save a co-signer wallet card before sharing securely" };
  }
  return publishSharedKey(
    deps,
    recipients,
    content,
    session.passphrase,
    authorized.isCurrent,
    coordinationRelayUrls(preferences),
  );
};

const publishSharedKey = async (
  deps: MultisigOpsDeps,
  recipients: ReturnType<typeof coordinationRecipients>,
  content: string,
  vaultPassphrase: string,
  isAuthorized: () => boolean,
  relayUrls: readonly string[],
): Promise<RuntimeResponse> => {
  const wrap = deps.wallet.wrapNostrApplicationData;
  if (!wrap) return { error: "Secure co-signer coordination is unavailable for this wallet" };
  try {
    const published = await publishForRecipients(
      recipients,
      content,
      MULTISIG_STRK20_KEY_IDENTIFIER,
      vaultPassphrase,
      isAuthorized,
      relayUrls,
      deps.nostrRelayTransport ?? nativeNostrRelayTransport,
      wrap,
      deps.wallet.wrapNostrApplicationDataBatch,
    );
    if (!published) return { error: "wallet locked" };
    return { ok: true, ...published };
  } catch {
    return { error: "Secure co-signer sharing is unavailable. Try again shortly" };
  }
};

const forget = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const multisigId = readMultisigId(message, FORGET);
  if (!multisigId) return { error: "invalid multisig key request" };
  const scope = await scopeFor(deps, multisigId);
  if ("error" in scope) return scope;
  const session = unlocked(deps);
  if ("error" in session) return session;
  const authorized = captureSessionAuthorization(deps.session);
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  const forgetKey = deps.wallet.forgetMultisigStrk20Key;
  if (!forgetKey) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  try {
    await forgetKey({
      chainId: scope.chainId,
      isAuthorized: authorized.isCurrent,
      multisigId,
      poolAddress: scope.poolAddress,
      vaultPassphrase: session.passphrase,
    });
  } catch (error) {
    const refusal = locked(error);
    if (refusal) return refusal;
    throw error;
  }
  return { ok: true };
};

/**
 * Drops every viewing key and conflict mark for a multisig that was just
 * removed. A lock before the commit starts leaves them stored.
 */
export const forgetStrk20KeysForRemovedMultisig = async (
  deps: MultisigOpsDeps,
  multisigId: string,
  isAuthorized: () => boolean,
): Promise<"locked" | "removed"> => {
  const session = unlocked(deps);
  const forgetKeys = deps.wallet.forgetMultisigStrk20Keys;
  if ("error" in session || !isAuthorized()) return "locked";
  if (!forgetKeys) return "removed";
  try {
    await forgetKeys({
      isAuthorized,
      multisigId,
      vaultPassphrase: session.passphrase,
    });
  } catch (error) {
    if (error instanceof WalletError && error.message === "wallet locked") return "locked";
    throw error;
  }
  return isAuthorized() ? "removed" : "locked";
};

/**
 * Handles viewing-key messages from the extension page. Other messages return
 * null so intent coordination can answer them.
 */
export const handleMultisigStrk20KeyOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === STATUS) return status(deps, message);
  if (messageType === CREATE) return create(deps, message);
  if (messageType === SHARE) return share(deps, message);
  if (messageType === FORGET) return forget(deps, message);
  return null;
};
