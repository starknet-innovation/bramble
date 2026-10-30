/** Explicit Nostr share and sync operations for existing Argent multisig intents. */
import { WalletError } from "@bramble/core/errors";
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import type { NostrApplicationData } from "@bramble/vault/kms-port";
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
import { handleMultisigTxOps } from "./multisig-tx-ops";
import {
  MULTISIG_NOSTR_RELAYS,
  type NostrRelayTransport,
  nativeNostrRelayTransport,
} from "./nostr-relay";

/** Application-data identifier every multisig gift wrap carries; mirrored by the mobile core. */
export const MULTISIG_NOSTR_IDENTIFIER = "bramble.multisig";
/** First-sync relay lookback; mirrored by the mobile core. */
export const NOSTR_SYNC_LOOKBACK_SECONDS = 30 * 24 * 60 * 60;
/**
 * Overlap kept behind the last checkpoint. NIP-59 backdates gift wraps by up to two days; the
 * extra day preserves a safe overlap while cutting later relay scans from 30 days to three.
 */
export const NOSTR_INCREMENTAL_LOOKBACK_SECONDS = 3 * 24 * 60 * 60;

/** One custom relay replaces the reviewed defaults; it never expands the broadcast set. */
export const coordinationRelayUrls = (preferences: WalletPreferences): readonly string[] =>
  preferences.nostrRelayUrl ? [preferences.nostrRelayUrl] : MULTISIG_NOSTR_RELAYS;

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

const signerContact = (
  contacts: readonly AddressBookEntry[],
  senderPublicKey: string,
  networkId: string,
  signerGuids: readonly string[],
): AddressBookEntry | null =>
  contacts.find(
    (contact) =>
      contact.networkId === networkId &&
      contact.nostrPublicKey === senderPublicKey &&
      !!contact.publicKeyX &&
      signerGuids.includes(argentSignerGuid(contact.publicKeyX)),
  ) ?? null;

const coordinationRecipients = (
  contacts: readonly AddressBookEntry[],
  networkId: string,
  ownPublicKey: string,
  signerGuids: readonly string[],
): readonly (AddressBookEntry & { readonly nostrPublicKey: string })[] => [
  ...new Map(
    contacts
      .filter(
        (contact): contact is AddressBookEntry & { readonly nostrPublicKey: string } =>
          contact.networkId === networkId &&
          contact.nostrPublicKey !== ownPublicKey &&
          !!contact.nostrPublicKey &&
          !!contact.publicKeyX &&
          signerGuids.includes(argentSignerGuid(contact.publicKeyX)),
      )
      .map((contact) => [contact.nostrPublicKey, contact]),
  ).values(),
];

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
    signerContact(
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

const publishForRecipients = async (
  recipients: readonly (AddressBookEntry & { readonly nostrPublicKey: string })[],
  content: string,
  vaultPassphrase: string,
  isAuthorized: () => boolean,
  relayUrls: readonly string[],
  transport: NostrRelayTransport,
  wrap: NonNullable<MultisigOpsDeps["wallet"]["wrapNostrApplicationData"]>,
  wrapMany: MultisigOpsDeps["wallet"]["wrapNostrApplicationDataBatch"],
): Promise<{
  readonly recipients: number;
  readonly relays: number;
  readonly totalRecipients: number;
} | null> => {
  const wrapped = wrapMany
    ? await wrapMany({
        isAuthorized,
        items: recipients.map((recipient) => ({
          content,
          identifier: MULTISIG_NOSTR_IDENTIFIER,
          recipientPublicKey: recipient.nostrPublicKey,
        })),
        vaultPassphrase,
      })
    : await Promise.all(
        recipients.map(async (recipient) => {
          if (!isAuthorized()) return null;
          try {
            return await wrap({
              content,
              identifier: MULTISIG_NOSTR_IDENTIFIER,
              recipientPublicKey: recipient.nostrPublicKey,
              vaultPassphrase,
            });
          } catch {
            return null;
          }
        }),
      );
  if (!isAuthorized()) return null;
  const deliveries = wrapped.flatMap((eventJson, index) => {
    const recipient = recipients[index];
    return eventJson && recipient
      ? [{ eventJson, recipientPublicKey: recipient.nostrPublicKey }]
      : [];
  });
  if (deliveries.length === 0) throw new Error("Nostr relays are unavailable");
  const relayCounts = transport.publishMany
    ? await transport.publishMany(deliveries, relayUrls)
    : await Promise.all(
        deliveries.map(({ eventJson, recipientPublicKey }) =>
          transport.publish(eventJson, recipientPublicKey, relayUrls).catch(() => 0),
        ),
      );
  if (!isAuthorized()) return null;
  const relays = relayCounts.reduce((sum, count) => sum + count, 0);
  if (relays === 0) throw new Error("Nostr relays are unavailable");
  return {
    recipients: relayCounts.filter((count) => count > 0).length,
    relays,
    totalRecipients: recipients.length,
  };
};

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

const nostrSyncSince = (nowSeconds: number, syncedAt: number | undefined): number =>
  Math.max(
    0,
    syncedAt !== undefined && syncedAt <= nowSeconds
      ? syncedAt - NOSTR_INCREMENTAL_LOOKBACK_SECONDS
      : nowSeconds - NOSTR_SYNC_LOOKBACK_SECONDS,
  );

// Import refusals that depend only on the package and the account's settled
// history, so retrying the same wrap can never succeed. Any other refusal
// (another active network, an RPC or storage failure, a full intent store) is
// left without a receipt and retried while the wrap stays inside the
// incremental lookback (Sherlock 129).
const FINAL_IMPORT_REFUSALS: ReadonlySet<string> = new Set([
  "Argent multisig intent conflict",
  "Argent multisig intent invalid",
  "Argent multisig intent is stale after a configuration change",
  "Argent multisig intent nonce is no longer current",
  "Argent multisig not found",
  "conflicting Argent multisig intent id",
  "invalid Argent multisig intent package",
]);

/** What one opened wrap did, and whether it may be skipped by later syncs. */
type SharedIntentImport = { readonly intentId?: string; readonly final: boolean };

const importSharedIntent = async (
  deps: MultisigOpsDeps,
  opened: NostrApplicationData,
  contacts: readonly AddressBookEntry[],
  records: readonly ArgentMultisigRecord[],
): Promise<SharedIntentImport> => {
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
    return { final: error instanceof WalletError };
  }
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
): Promise<{
  readonly intentIds: readonly string[];
  readonly verifiedEventIds: readonly string[];
} | null> => {
  const imported = new Set<string>();
  const verifiedEventIds = new Set<string>();
  if (events.length === 0) return { intentIds: [], verifiedEventIds: [] };
  const opened = await openGiftWraps(events, vaultPassphrase, isAuthorized, open, openMany);
  if (!opened) return null;
  for (const index of events.keys()) {
    if (!isAuthorized()) return null;
    const content = opened[index];
    if (!content) continue;
    const result = await importSharedIntentSafely(deps, content, contacts, records);
    if (result.intentId) imported.add(result.intentId);
    // A receipt only for a wrap this sync finished with: imported, a no-op, or
    // refused for good. A wrap refused for a passing reason is opened again.
    const event = events[index];
    if (event && result.final) verifiedEventIds.add(event.id);
  }
  return { intentIds: [...imported], verifiedEventIds: [...verifiedEventIds] };
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

const syncIntents = async (deps: MultisigOpsDeps, multisigId: string): Promise<RuntimeResponse> => {
  if (!deps.wallet.nostrPublicKey || !deps.wallet.openNostrApplicationData) {
    return { error: "Secure co-signer coordination is unavailable for this wallet" };
  }
  const record = (await deps.multisigStore.listMultisigs()).find(
    (candidate) => candidate.id === multisigId,
  );
  if (!record) return { error: "Argent multisig not found" };
  const nostrPublicKeyFor = deps.wallet.nostrPublicKey;
  const open = deps.wallet.openNostrApplicationData;
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
  const unseenEvents = events.filter((event) => !seenEventIds.has(event.id));
  const imported = await importGiftWraps(
    deps,
    unseenEvents,
    preferences.addressBook,
    [record],
    passphrase,
    authorized.isCurrent,
    open,
    deps.wallet.openNostrApplicationDataBatch,
  );
  if (imported === null) {
    return authorized.isCurrent()
      ? { error: "Secure co-signer updates could not be verified. Try again shortly" }
      : { error: "wallet locked" };
  }
  await deps.nostrCoordinationStore
    .recordSync(
      {
        accountId: record.id,
        eventIds: imported.verifiedEventIds,
        relayUrls,
        syncedAt: nowSeconds,
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
  if (messageType === "wallet.shareArgentMultisigIntent") return shareIntent(deps, message);
  if (messageType === "wallet.syncArgentMultisigIntents") {
    const input = readMultisigIdInput(message, messageType);
    return input
      ? syncIntents(deps, input.multisigId)
      : { error: "invalid Nostr multisig sync request" };
  }
  return null;
};
