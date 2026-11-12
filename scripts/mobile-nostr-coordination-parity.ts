/**
 * Parity vectors for the Nostr multisig coordination rules the shared core will port (wallet-core
 * plan, step 2.5): relay URLs, gift-wrap batches, acknowledgement counts, sync paging, the sync
 * window, relay policy, and recipient selection with the sender rule. Every expected value is the
 * return (or the thrown message) of the extension's own function over fixed inputs and fixed
 * clocks; nothing is random, so the conformance test recomputes the whole fixture.
 *
 * The relay-side sections live in `mobile-nostr-coordination-relay.ts` and
 * `mobile-nostr-coordination-paging.ts`; this module holds the pure rules and assembles the parts.
 */
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { isNostrRelayUrl } from "@bramble/wallet-model/nostr";
import type { AddressBookEntry } from "@bramble/wallet-model/preferences";
import {
  coordinationRecipients,
  coordinationRelayUrls,
  isCoordinationSigner,
} from "../apps/extension/src/background/multisig/multisig-nostr-publish";
import {
  isWrapPastRetry,
  NOSTR_INCREMENTAL_LOOKBACK_SECONDS,
  NOSTR_SYNC_LOOKBACK_SECONDS,
  nostrSyncSince,
  retryableSyncedAt,
} from "../apps/extension/src/background/multisig/multisig-sync-window";
import { MULTISIG_NOSTR_RELAYS } from "../apps/extension/src/background/multisig/nostr-relay";
import { withNostrRelayUrl } from "../packages/features/settings/src/preferences-nostr";
import { pagingParity } from "./mobile-nostr-coordination-paging";
import { CUSTOM_RELAY, errorOf, relayParity } from "./mobile-nostr-coordination-relay";

/** The fixture parts, split to keep each file inside the repository's line budget. */
export const NOSTR_COORDINATION_FIXTURE_PATHS = {
  paging: "mobile/core/tests/fixtures/nostr-coordination-parity-paging.json",
  relays: "mobile/core/tests/fixtures/nostr-coordination-parity-relays.json",
  rules: "mobile/core/tests/fixtures/nostr-coordination-parity-rules.json",
} as const;

// ---- relay URLs --------------------------------------------------------------------------------

const RELAY_URL_CASES: readonly string[] = [
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://relay.example/",
  "wss://relay.example/path?x=1",
  "wss://relay.example?x=1",
  "wss://relay.example:7447",
  "wss://relay.example:443",
  "wss://relay.example:0",
  "wss://relay.example:07447",
  "wss://relay.example:70000",
  "wss://relay.example.",
  "wss://127.0.0.1:7000",
  "wss://[::1]:7000/nostr",
  "wss://[0:0:0:0:0:0:0:1]",
  "wss://010.0.0.1",
  "WSS://relay.example",
  "wss://Relay.Example",
  " wss://relay.example",
  "wss://relay.example ",
  "",
  "ws://localhost:7000",
  "ws://127.0.0.1:7000",
  "ws://[::1]:7000",
  "ws://relay.example",
  "https://relay.example",
  "wss://user:pw@relay.example",
  "wss://@relay.example",
  "wss://relay.example/#frag",
  "wss://relay.example#",
  "wss://",
  "wss:relay.example",
  "wss:\\\\relay.example",
  "not a url",
  "wss://réseau.example",
  "wss://xn--rseau-bsa.example",
  "wss://relay.example/a/../b",
  "wss://relay.example/%2e/b",
  "wss://relay.example/a b",
  "wss://relay.example/?q=it's",
  `wss://relay.example/${"a".repeat(2048 - 20)}`,
  `wss://relay.example/${"a".repeat(2049 - 20)}`,
];

const relayUrls = () =>
  RELAY_URL_CASES.map((value) => ({ accepted: isNostrRelayUrl(value), value }));

// ---- sync window -------------------------------------------------------------------------------

const NOW = 1_750_000_000;
const DAY = 24 * 60 * 60;

const syncWindow = () => ({
  incrementalLookbackSeconds: NOSTR_INCREMENTAL_LOOKBACK_SECONDS,
  lookbackSeconds: NOSTR_SYNC_LOOKBACK_SECONDS,
  // `nostrSyncSince(now, syncedAt)`: the `since` of a relay query.
  since: [
    { now: NOW, syncedAt: null },
    { now: NOW, syncedAt: NOW },
    { now: NOW, syncedAt: NOW - 10 * DAY },
    { now: NOW, syncedAt: NOW - 40 * DAY },
    { now: NOW, syncedAt: NOW + 1 },
    { now: NOW, syncedAt: 0 },
    { now: 1_000, syncedAt: null },
    { now: 0, syncedAt: 0 },
  ].map(({ now, syncedAt }) => ({
    now,
    since: nostrSyncSince(now, syncedAt ?? undefined),
    syncedAt,
  })),
  // `retryableSyncedAt(now, oldestRetryableAt)`: the checkpoint a sync records.
  syncedAt: [
    { now: NOW, oldestRetryableAt: null },
    { now: NOW, oldestRetryableAt: NOW - DAY },
    { now: NOW, oldestRetryableAt: NOW - 3 * DAY },
    { now: NOW, oldestRetryableAt: NOW - 20 * DAY },
    { now: NOW, oldestRetryableAt: NOW + DAY },
  ].map(({ now, oldestRetryableAt }) => ({
    now,
    oldestRetryableAt,
    syncedAt: retryableSyncedAt(now, oldestRetryableAt),
  })),
  // `isWrapPastRetry(createdAt, now)`: a retryable wrap that has aged out is receipted as final.
  pastRetry: [
    { createdAt: NOW, now: NOW },
    { createdAt: NOW - 30 * DAY, now: NOW },
    { createdAt: NOW - 30 * DAY - 1, now: NOW },
    { createdAt: NOW - 30 * DAY, now: NOW + 0.5 },
    { createdAt: 0, now: 1_000 },
  ].map(({ createdAt, now }) => ({ createdAt, now, pastRetry: isWrapPastRetry(createdAt, now) })),
});

// ---- relay policy ------------------------------------------------------------------------------

const RELAY_POLICY_CASES: readonly {
  readonly name: string;
  readonly stored: string | null;
  readonly input: string | null;
}[] = [
  { input: null, name: "defaults", stored: null },
  { input: null, name: "a stored custom relay", stored: CUSTOM_RELAY },
  { input: CUSTOM_RELAY, name: "a custom relay replaces the defaults", stored: null },
  { input: "  wss://relay.team.example/x \n", name: "the input is trimmed", stored: null },
  { input: "wss://nos.lol", name: "a default relay alone", stored: null },
  { input: "", name: "empty restores the defaults", stored: CUSTOM_RELAY },
  { input: " \t ", name: "blank restores the defaults", stored: CUSTOM_RELAY },
  { input: "ws://relay.example", name: "an insecure relay is refused", stored: null },
  { input: "WSS://relay.example", name: "a non-canonical relay is refused", stored: null },
  { input: "ws://localhost:7000", name: "a loopback relay", stored: null },
];

const relayPolicy = () => ({
  defaults: MULTISIG_NOSTR_RELAYS,
  cases: RELAY_POLICY_CASES.map(({ input, name, stored }) => {
    const preferences = {
      ...defaultWalletPreferences(),
      ...(stored === null ? {} : { nostrRelayUrl: stored }),
    };
    try {
      const next = input === null ? preferences : withNostrRelayUrl(preferences, input);
      return { input, name, relayUrls: coordinationRelayUrls(next), stored };
    } catch (error) {
      return { error: errorOf(error), input, name, stored };
    }
  }),
});

// ---- recipients and the sender rule ------------------------------------------------------------

const NETWORK = "SN_SEPOLIA";
const OWN = "a0".repeat(32);
const nostr = (n: number) => `a${n}`.repeat(32);
// Stark keys of the signer set (1, 2 and 4) and one outside it (3).
const SIGNER_KEYS = ["0x111", "0x222", "0x444"] as const;
const OUTSIDE_KEY = "0x333";

const contact = (
  id: string,
  networkId: "SN_MAIN" | "SN_SEPOLIA",
  nostrPublicKey: string | null,
  publicKeyX: string | null,
): AddressBookEntry => ({
  address: `0x${id.length.toString(16)}${id.charCodeAt(0).toString(16)}`,
  id,
  label: id,
  networkId,
  ...(nostrPublicKey ? { nostrPublicKey } : {}),
  ...(publicKeyX ? { publicKeyX } : {}),
});

const CONTACTS: readonly AddressBookEntry[] = [
  contact("signer", NETWORK, nostr(1), "0x111"),
  contact("other network", "SN_MAIN", nostr(2), "0x111"),
  contact("own key", NETWORK, OWN, "0x222"),
  contact("no nostr key", NETWORK, null, "0x222"),
  contact("no stark key", NETWORK, nostr(3), null),
  contact("not a signer", NETWORK, nostr(4), OUTSIDE_KEY),
  contact("same nostr key again", NETWORK, nostr(1), "0x444"),
  contact("second signer", NETWORK, nostr(5), "0x444"),
  contact("not a signer, same nostr key", NETWORK, nostr(5), OUTSIDE_KEY),
];

const SENDERS: readonly { readonly senderPublicKey: string; readonly networkId: string }[] = [
  { networkId: NETWORK, senderPublicKey: nostr(1) },
  { networkId: NETWORK, senderPublicKey: nostr(2) },
  { networkId: "SN_MAIN", senderPublicKey: nostr(2) },
  { networkId: NETWORK, senderPublicKey: nostr(3) },
  { networkId: NETWORK, senderPublicKey: nostr(4) },
  { networkId: NETWORK, senderPublicKey: nostr(5) },
  { networkId: NETWORK, senderPublicKey: OWN },
  { networkId: NETWORK, senderPublicKey: nostr(6) },
  { networkId: "SN_MAIN", senderPublicKey: nostr(1) },
];

const recipients = () => {
  const signers = SIGNER_KEYS.map((publicKeyX) => ({
    guid: argentSignerGuid(publicKeyX),
    publicKeyX,
  }));
  const signerGuids = signers
    .map(({ guid }) => guid)
    .sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : 1));
  return {
    contacts: CONTACTS,
    networkId: NETWORK,
    ownPublicKey: OWN,
    // `coordinationRecipients`: the ids of the saved cards a share goes to, in order.
    recipients: coordinationRecipients(CONTACTS, NETWORK, OWN, signerGuids).map(({ id }) => id),
    // `isCoordinationSigner`: whether a gift wrap from this sender may be imported.
    senders: SENDERS.map((sender) => ({
      ...sender,
      signer: isCoordinationSigner(CONTACTS, sender.senderPublicKey, sender.networkId, signerGuids),
    })),
    signerGuids,
    signers,
  };
};

/** Every vector, split into the fixture's parts; the conformance test recomputes it. */
export const computeNostrCoordinationParity = async () => ({
  paging: await pagingParity(),
  relays: await relayParity(),
  rules: {
    recipients: recipients(),
    relayPolicy: relayPolicy(),
    relayUrls: relayUrls(),
    syncWindow: syncWindow(),
  },
});
