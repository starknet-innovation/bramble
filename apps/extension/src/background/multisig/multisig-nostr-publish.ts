/**
 * Recipient selection and gift-wrap publication for Argent multisig Nostr
 * coordination. The payload is already authenticated application data; this
 * module does not inspect it.
 */

import type { WalletPreferences } from "@bramble/settings/preferences";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";
import type { MultisigOpsDeps } from "./multisig-deps";
import { MULTISIG_NOSTR_RELAYS, type NostrRelayTransport } from "./nostr-relay";

/** One custom relay replaces the reviewed defaults; it never expands the broadcast set. */
export const coordinationRelayUrls = (preferences: WalletPreferences): readonly string[] =>
  preferences.nostrRelayUrl ? [preferences.nostrRelayUrl] : MULTISIG_NOSTR_RELAYS;

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

/**
 * True when the Nostr sender is a saved contact whose Stark key is in the
 * signer set. A stranger's gift wrap is ignored.
 */
export const isCoordinationSigner = (
  contacts: readonly AddressBookEntry[],
  senderPublicKey: string,
  networkId: string,
  signerGuids: readonly string[],
): boolean => signerContact(contacts, senderPublicKey, networkId, signerGuids) !== null;

/**
 * Saved co-signer cards on this network, excluding this wallet's own Nostr key.
 * One card per Nostr key.
 */
export const coordinationRecipients = (
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

/**
 * Wraps one payload for every recipient and publishes each gift wrap.
 * `identifier` selects the application kind Krusty authenticates. Returns null
 * when authorization lapses. Throws when no relay accepts a wrap.
 */
export const publishForRecipients = async (
  recipients: readonly (AddressBookEntry & { readonly nostrPublicKey: string })[],
  content: string,
  identifier: string,
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
          identifier,
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
              identifier,
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
