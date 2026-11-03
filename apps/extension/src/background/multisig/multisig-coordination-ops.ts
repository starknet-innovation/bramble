/** Explicit Nostr share and sync operations for existing Argent multisig intents. */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import type { NostrApplicationData } from "@bramble/vault/kms-port";
import { isMultisigStrk20CapacityRefusal } from "@bramble/vault/service";
import {
  isNostrApplicationData,
  isNostrPublicKey,
  type NostrEvent,
} from "@bramble/wallet-model/nostr";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";
import { runActiveStateMutation } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import type { MultisigOpsDeps } from "./multisig-deps";
import {
  argentMultisigIntentPackage,
  readImportIntentInput,
  readMultisigIdInput,
} from "./multisig-inputs";
import {
  coordinationRecipients,
  coordinationRelayUrls,
  isCoordinationSigner,
  publishForRecipients,
} from "./multisig-nostr-publish";
import {
  handleMultisigStrk20KeyOps,
  importSharedStrk20Key,
  type Strk20KeyImport,
} from "./multisig-strk20-key-ops";
import { importSharedStrk20Authorization } from "./multisig-strk20-relay";
import { handleMultisigTxOps } from "./multisig-tx-ops";
import { type NostrRelayTransport, nativeNostrRelayTransport } from "./nostr-relay";

export { coordinationRelayUrls } from "./multisig-nostr-publish";

const MULTISIG_NOSTR_IDENTIFIER = "bramble.multisig";
const NOSTR_SYNC_LOOKBACK_SECONDS = 30 * 24 * 60 * 60;
const NOSTR_INCREMENTAL_LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

const readIntentId = (message: unknown): string | null =>
  isRecord(message) &&
  hasOnlyKnownKeys(message, ["intentId", "type"]) &&
  message["type"] === "wallet.shareArgentMultisigIntent" &&
  typeof message["intentId"] === "string" &&
  message["intentId"].length > 0 &&
  message["intentId"].length <= 256
    ? message["intentId"]
    : null;

const isTypeOnly = (message: unknown, type: string): boolean =>
  isRecord(message) && hasOnlyKnownKeys(message, ["type"]) && message["type"] === type;

const parseSharedIntent = (content: string) => {
  let packageMessage: unknown;
  try {
    packageMessage = JSON.parse(content);
  } catch {
    return null;
  }
  return readImportIntentInput({
    package: packageMessage,
    type: "wallet.importArgentMultisigIntent",
  });
};

const openGiftWrap = async (
  open: NonNullable<MultisigOpsDeps["wallet"]["openNostrApplicationData"]>,
  event: NostrEvent,
  vaultPassphrase: string,
): Promise<NostrApplicationData | null> => {
  try {
    return await open({ eventJson: JSON.stringify(event), vaultPassphrase });
  } catch {
    return null;
  }
};

const openGiftWraps = (
  events: readonly NostrEvent[],
  vaultPassphrase: string,
  isAuthorized: () => boolean,
  open: NonNullable<MultisigOpsDeps["wallet"]["openNostrApplicationData"]>,
  openMany: MultisigOpsDeps["wallet"]["openNostrApplicationDataBatch"],
): Promise<readonly (NostrApplicationData | null)[] | null> =>
  openMany
    ? openMany({
        eventJsons: events.map((event) => JSON.stringify(event)),
        isAuthorized,
        vaultPassphrase,
      }).catch(() => null)
    : Promise.all(events.map((event) => openGiftWrap(open, event, vaultPassphrase)));

/** Accepts only a package from a saved Nostr identity whose Stark key is in the frozen signer set. */
export const trustedSharedIntent = (
  opened: NostrApplicationData,
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
) => {
  if (
    opened.identifier !== MULTISIG_NOSTR_IDENTIFIER ||
    !isNostrPublicKey(opened.senderPublicKey)
  ) {
    return null;
  }
  const input = parseSharedIntent(opened.content);
  const record = records.find((candidate) => candidate.id === input?.package.intent.accountId);
  return input &&
    record &&
    isCoordinationSigner(
      contacts,
      opened.senderPublicKey,
      record.networkId,
      input.package.intent.configSnapshot.signerGuids,
    )
    ? input
    : null;
};

/** Returns true only when a handoff can create an intent or add a signer fragment. */
export const sharedIntentHasUpdate = (
  current: ArgentMultisigSigningIntent | null,
  incoming: ArgentMultisigSigningIntent,
): boolean =>
  !current ||
  ((current.state === "collecting" || current.state === "ready") &&
    incoming.signatures.some(
      (signature) => !current.signatures.some((stored) => stored.publicKey === signature.publicKey),
    ));

const recentGiftWraps = async (
  publicKey: string,
  since: number,
  relayUrls: readonly string[],
  transport: NostrRelayTransport,
  seenEventIds: ReadonlySet<string>,
): Promise<readonly NostrEvent[] | null> => {
  try {
    return await transport.sync(publicKey, since, relayUrls, seenEventIds);
  } catch {
    return null;
  }
};

const retryableSyncedAt = (nowSeconds: number, oldestRetryableAt: number | null): number =>
  oldestRetryableAt === null
    ? nowSeconds
    : Math.min(nowSeconds, oldestRetryableAt + NOSTR_INCREMENTAL_LOOKBACK_SECONDS);

const nostrSyncSince = (nowSeconds: number, syncedAt: number | undefined): number =>
  Math.max(
    0,
    syncedAt !== undefined && syncedAt <= nowSeconds
      ? syncedAt - NOSTR_INCREMENTAL_LOOKBACK_SECONDS
      : nowSeconds - NOSTR_SYNC_LOOKBACK_SECONDS,
  );

const FINAL_IMPORT_REFUSALS: ReadonlySet<string> = new Set([
  "Argent multisig intent conflict",
  "Argent multisig intent invalid",
  "Argent multisig intent is stale after a configuration change",
  "Argent multisig intent nonce is no longer current",
  "Argent multisig not found",
  "conflicting Argent multisig intent id",
  "invalid Argent multisig intent package",
]);

type SharedIntentImport = {
  readonly final: boolean;
  readonly intentId?: string;
  readonly strk20Key?: Strk20KeyImport["strk20Key"];
};

type OpenedWraps = {
  readonly intentIds: string[];
  readonly oldestRetryableAt: number | null;
  readonly strk20Key: "conflict" | "held" | "none" | "stored";
  readonly verifiedEventIds: string[];
};

const importSharedIntent = async (
  deps: MultisigOpsDeps,
  opened: NostrApplicationData,
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
  vaultPassphrase: string,
  isAuthorized: () => boolean,
): Promise<SharedIntentImport> => {
  const key = await importSharedStrk20Key(
    deps,
    opened,
    contacts,
    records,
    vaultPassphrase,
    isAuthorized,
  );
  if (key) return key;
  const authorization = await importSharedStrk20Authorization(
    deps,
    opened,
    contacts,
    records,
    vaultPassphrase,
    isAuthorized,
  );
  if (authorization) return authorization;
  const input = trustedSharedIntent(opened, contacts, records);
  if (!input) return { final: true };
  const incoming = input.package.intent;
  const current = await deps.multisigStore.getIntent(incoming.id);
  // A relay can serve a removed intent again under any event id, so the
  // removal itself is what keeps it out (Sherlock 168, 237).
  const removed =
    !current &&
    (await deps.nostrCoordinationStore.isRemovedIntent(incoming.accountId, incoming.id));
  if (removed || !sharedIntentHasUpdate(current, incoming)) return { final: true };
  const response = await runActiveStateMutation(deps.activeStateCoordinator, () =>
    handleMultisigTxOps(deps, "wallet.importArgentMultisigIntent", {
      package: input.package,
      type: "wallet.importArgentMultisigIntent",
    }),
  );
  if (!response) return { final: false };
  if (!("error" in response)) return { final: true, intentId: input.package.intent.id };
  const refusal = response.error;
  return { final: typeof refusal === "string" && FINAL_IMPORT_REFUSALS.has(refusal) };
};

// One wrap can never stop the rest of a sync (Sherlock 141). The call-safety
// validators throw a `WalletError` for a call set that can never become valid,
// which is final; any other throw is treated as a failure worth retrying.
const importSharedIntentSafely = async (
  ...args: Parameters<typeof importSharedIntent>
): Promise<SharedIntentImport> => {
  try {
    return await importSharedIntent(...args);
  } catch (error) {
    if (error instanceof WalletError && error.message === "wallet locked") throw error;
    return { final: error instanceof WalletError && !isMultisigStrk20CapacityRefusal(error) };
  }
};

const keyRank = (value: "conflict" | "held" | "none" | "stored"): number =>
  value === "conflict" ? 3 : value === "stored" ? 2 : value === "held" ? 1 : 0;

const noteWrap = (
  imported: Set<string>,
  verifiedEventIds: Set<string>,
  strk20Key: "conflict" | "held" | "none" | "stored",
  result: SharedIntentImport,
  event: NostrEvent | undefined,
): "conflict" | "held" | "none" | "stored" => {
  if (result.intentId) imported.add(result.intentId);
  if (event && result.final) verifiedEventIds.add(event.id);
  return result.strk20Key && keyRank(result.strk20Key) > keyRank(strk20Key)
    ? result.strk20Key
    : strk20Key;
};

const recordOpenedWraps = async (
  deps: MultisigOpsDeps,
  events: readonly NostrEvent[],
  opened: readonly (NostrApplicationData | null)[],
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
  vaultPassphrase: string,
  isAuthorized: () => boolean,
): Promise<OpenedWraps | null> => {
  const imported = new Set<string>();
  const verifiedEventIds = new Set<string>();
  let oldestRetryableAt: number | null = null;
  let strk20Key: "conflict" | "held" | "none" | "stored" = "none";
  for (const index of events.keys()) {
    if (!isAuthorized()) return null;
    const content = opened[index];
    if (!content) continue;
    const result = await importSharedIntentSafely(
      deps,
      content,
      contacts,
      records,
      vaultPassphrase,
      isAuthorized,
    );
    const event = events[index];
    if (!result.final && event) {
      oldestRetryableAt = Math.min(oldestRetryableAt ?? event.created_at, event.created_at);
    }
    strk20Key = noteWrap(imported, verifiedEventIds, strk20Key, result, event);
  }
  return {
    intentIds: [...imported],
    oldestRetryableAt,
    strk20Key,
    verifiedEventIds: [...verifiedEventIds],
  };
};

const importGiftWraps = async (
  deps: MultisigOpsDeps,
  events: readonly NostrEvent[],
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
  vaultPassphrase: string,
  isAuthorized: () => boolean,
  open: NonNullable<MultisigOpsDeps["wallet"]["openNostrApplicationData"]>,
  openMany: MultisigOpsDeps["wallet"]["openNostrApplicationDataBatch"],
): Promise<OpenedWraps | null> => {
  if (events.length === 0) {
    return { intentIds: [], oldestRetryableAt: null, strk20Key: "none", verifiedEventIds: [] };
  }
  const opened = await openGiftWraps(events, vaultPassphrase, isAuthorized, open, openMany);
  if (!opened) return null;
  // A receipt only for a wrap this sync finished with. A passing refusal is opened again.
  return recordOpenedWraps(deps, events, opened, contacts, records, vaultPassphrase, isAuthorized);
};

const publicKey = async (deps: MultisigOpsDeps): Promise<RuntimeResponse> => {
  if (!deps.wallet.nostrPublicKey) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  const passphrase = deps.session.getPassphrase();
  if (!passphrase) return { error: "wallet locked" };
  return { nostrPublicKey: await deps.wallet.nostrPublicKey(passphrase), ok: true };
};

const shareIntent = async (deps: MultisigOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const intentId = readIntentId(message);
  if (!intentId) return { error: "invalid Nostr multisig share request" };
  if (!deps.wallet.nostrPublicKey || !deps.wallet.wrapNostrApplicationData) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  const nostrPublicKeyFor = deps.wallet.nostrPublicKey;
  const wrap = deps.wallet.wrapNostrApplicationData;
  const passphrase = deps.session.getPassphrase();
  const authorized = captureSessionAuthorization(deps.session);
  if (!passphrase || !authorized.isCurrent()) return { error: "wallet locked" };
  const intent = await deps.multisigStore.getIntent(intentId);
  if (!intent) return { error: "Argent multisig intent not found" };
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === intent.accountId,
  );
  if (!record) return { error: "Argent multisig not found" };
  const preferences = await deps.preferencesStore.read();
  const ownPublicKey = await nostrPublicKeyFor(passphrase);
  const recipients = coordinationRecipients(
    preferences.addressBook,
    record.networkId,
    ownPublicKey,
    intent.configSnapshot.signerGuids,
  );
  if (recipients.length === 0) {
    return { error: "Save a co-signer wallet card before sharing securely" };
  }
  const content = JSON.stringify(argentMultisigIntentPackage(intent));
  if (!isNostrApplicationData(content)) {
    return {
      error: "This intent is too large for secure relay sharing. Copy the intent package instead",
    };
  }
  let published: Awaited<ReturnType<typeof publishForRecipients>>;
  try {
    published = await publishForRecipients(
      recipients,
      content,
      MULTISIG_NOSTR_IDENTIFIER,
      passphrase,
      authorized.isCurrent,
      coordinationRelayUrls(preferences),
      deps.nostrRelayTransport ?? nativeNostrRelayTransport,
      wrap,
      deps.wallet.wrapNostrApplicationDataBatch,
    );
  } catch {
    return { error: "Secure co-signer sharing is unavailable. Try again shortly" };
  }
  if (!published) return { error: "wallet locked" };
  return { ok: true, ...published };
};

const openUnseenWraps = async (
  deps: MultisigOpsDeps,
  events: readonly NostrEvent[],
  record: ArgentMultisigRecord,
  contacts: readonly AddressBookEntry[],
  vaultPassphrase: string,
  isAuthorized: () => boolean,
  open: NonNullable<MultisigOpsDeps["wallet"]["openNostrApplicationData"]>,
): Promise<OpenedWraps | { readonly error: string }> => {
  try {
    const imported = await importGiftWraps(
      deps,
      events,
      contacts,
      [record],
      vaultPassphrase,
      isAuthorized,
      open,
      deps.wallet.openNostrApplicationDataBatch,
    );
    if (imported) return imported;
    return isAuthorized()
      ? { error: "Secure co-signer updates could not be verified. Try again shortly" }
      : { error: "wallet locked" };
  } catch (error) {
    if (error instanceof WalletError && error.message === "wallet locked") {
      return { error: "wallet locked" };
    }
    throw error;
  }
};

const syncIntents = async (deps: MultisigOpsDeps, multisigId: string): Promise<RuntimeResponse> => {
  const open = deps.wallet.openNostrApplicationData;
  if (!deps.wallet.nostrPublicKey || !open) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === multisigId,
  );
  if (!record) return { error: "Argent multisig not found" };
  const nostrPublicKeyFor = deps.wallet.nostrPublicKey;
  const passphrase = deps.session.getPassphrase();
  const authorized = captureSessionAuthorization(deps.session);
  if (!passphrase || !authorized.isCurrent()) return { error: "wallet locked" };
  const nostrPublicKey = await nostrPublicKeyFor(passphrase);
  const preferences = await deps.preferencesStore.read();
  const relayUrls = coordinationRelayUrls(preferences);
  const nowSeconds = Math.floor(deps.now() / 1_000);
  const checkpoint = await deps.nostrCoordinationStore.getCheckpoint(record.id, relayUrls);
  const seenEventIds = new Set(checkpoint?.eventIds ?? []);
  const events = await recentGiftWraps(
    nostrPublicKey,
    nostrSyncSince(nowSeconds, checkpoint?.syncedAt),
    relayUrls,
    deps.nostrRelayTransport ?? nativeNostrRelayTransport,
    seenEventIds,
  );
  if (!events) {
    return { error: "Secure co-signer updates are unavailable. Try again shortly" };
  }
  const imported = await openUnseenWraps(
    deps,
    events.filter((event) => !seenEventIds.has(event.id)),
    record,
    preferences.addressBook,
    passphrase,
    authorized.isCurrent,
    open,
  );
  if ("error" in imported) return imported;
  await deps.nostrCoordinationStore
    .recordSync(
      {
        accountId: record.id,
        eventIds: imported.verifiedEventIds,
        relayUrls,
        syncedAt: retryableSyncedAt(nowSeconds, imported.oldestRetryableAt),
      },
      authorized.isCurrent,
    )
    .catch(() => "invalid" as const);
  if (!authorized.isCurrent()) return { error: "wallet locked" };
  return {
    imported: imported.intentIds.length,
    intentIds: imported.intentIds,
    ok: true,
    received: imported.verifiedEventIds.length,
    strk20Key: imported.strk20Key,
  };
};

/** Handles trusted-page Nostr coordination requests and no other messages. */
export const handleMultisigCoordinationOps = async (
  deps: MultisigOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.nostrPublicKey") {
    return isTypeOnly(message, messageType)
      ? publicKey(deps)
      : { error: "invalid Nostr identity request" };
  }
  const key = await handleMultisigStrk20KeyOps(deps, messageType, message);
  if (key) return key;
  if (messageType === "wallet.shareArgentMultisigIntent") return shareIntent(deps, message);
  if (messageType === "wallet.syncArgentMultisigIntents") {
    const input = readMultisigIdInput(message, messageType);
    return input
      ? syncIntents(deps, input.multisigId)
      : { error: "invalid Nostr multisig sync request" };
  }
  return null;
};
