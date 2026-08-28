/** Explicit Nostr share and sync operations for existing Argent multisig intents. */
import { hasOnlyKnownKeys, isRecord } from "@mc-wallet/core/json";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@mc-wallet/multisig/repository";
import { argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import type { NostrApplicationData } from "@mc-wallet/vault/kms-port";
import {
  isNostrApplicationData,
  isNostrPublicKey,
  type NostrEvent,
} from "@mc-wallet/wallet-model/nostr";
import type { AddressBookEntry } from "@mc-wallet/wallet-model/preferences";
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
import { publishNostrGiftWrap, syncNostrGiftWraps } from "./nostr-relay";

const MULTISIG_NOSTR_IDENTIFIER = "mc-wallet.multisig";
const NOSTR_SYNC_LOOKBACK_SECONDS = 30 * 24 * 60 * 60;

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
  wrap: NonNullable<MultisigOpsDeps["wallet"]["wrapNostrApplicationData"]>,
): Promise<{ readonly recipients: number; readonly relays: number } | null> => {
  const results = await Promise.allSettled(
    recipients.map(async (recipient) => {
      if (!isAuthorized()) return null;
      const event = await wrap({
        content,
        identifier: MULTISIG_NOSTR_IDENTIFIER,
        recipientPublicKey: recipient.nostrPublicKey,
        vaultPassphrase,
      });
      return isAuthorized() ? publishNostrGiftWrap(event, recipient.nostrPublicKey) : null;
    }),
  );
  if (!isAuthorized()) return null;
  const delivered = results.flatMap((result) =>
    result.status === "fulfilled" && result.value !== null ? [result.value] : [],
  );
  if (delivered.length === 0) throw new Error("Nostr relays are unavailable");
  return { recipients: delivered.length, relays: delivered.reduce((sum, count) => sum + count, 0) };
};

const recentGiftWraps = async (
  publicKey: string,
  since: number,
): Promise<readonly NostrEvent[] | null> => {
  try {
    return await syncNostrGiftWraps(publicKey, since);
  } catch {
    return null;
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
): Promise<number | null> => {
  let imported = 0;
  for (const event of events) {
    if (!isAuthorized()) return null;
    const opened = await openGiftWrap(open, event, vaultPassphrase);
    if (!opened) continue;
    const input = trustedSharedIntent(opened, contacts, records);
    if (!input) continue;
    const current = await deps.multisigStore.getIntent(input.package.intent.id);
    if (!sharedIntentHasUpdate(current, input.package.intent)) continue;
    const response = await runActiveStateMutation(deps.activeStateCoordinator, () =>
      handleMultisigTxOps(deps, "wallet.importArgentMultisigIntent", {
        package: input.package,
        type: "wallet.importArgentMultisigIntent",
      }),
    );
    if (response && !("error" in response)) imported += 1;
  }
  return imported;
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
      wrap,
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
  const events = await recentGiftWraps(
    nostrPublicKey,
    Math.max(0, Math.floor(deps.now() / 1_000) - NOSTR_SYNC_LOOKBACK_SECONDS),
  );
  if (!events) {
    return { error: "Secure co-signer updates are unavailable. Try again shortly" };
  }
  const preferences = await deps.preferencesStore.read();
  const imported = await importGiftWraps(
    deps,
    events,
    preferences.addressBook,
    [record],
    passphrase,
    authorized.isCurrent,
    open,
  );
  if (imported === null) return { error: "wallet locked" };
  return { imported, ok: true, received: events.length };
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
