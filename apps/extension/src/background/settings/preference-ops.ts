/**
 * Preference operations dispatched from the background message handler:
 * address book management, account labels, display settings, RPC overrides,
 * and backup import. All are privileged extension-page messages.
 */
import type { WalletPreferences, WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import {
  readRemoveNftInput,
  readSetNftIndexerUrlInput,
  readSetNftSpamInput,
} from "../portfolio/nft-inputs";
import {
  readCreateGroupInput,
  readImportPreferencesInput,
  readRemoveAddressInput,
  readRemoveGroupInput,
  readRenameGroupInput,
  readSaveAddressInput,
  readSetAccountInGroupInput,
  readSetAccountLabelInput,
  readSetDisplayInput,
  readSetExplorerFallbackInput,
  readSetGroupIconInput,
  readSetRpcOverrideInput,
  readSetStrk20NetworkConfigInput,
  readTypeOnlyInput,
} from "../routing/message-inputs";
import type { RuntimeResponse } from "../runtime/runtime-types";

/**
 * Reads and validates a preference message, then applies its store mutation.
 * Absent keys are non-preference messages handled by the caller.
 */
type PreferenceHandler = (
  store: WalletPreferencesStore,
  message: unknown,
) => Promise<RuntimeResponse>;

/**
 * Builds a handler that parses `message` with `read`, returns `error` when the
 * payload is malformed, and otherwise responds with the preferences produced by
 * `mutate`. Keeps every entry in the dispatch map a pure validate->mutate->respond.
 */
const parseThen = <T>(
  read: (message: unknown) => T | null,
  error: string,
  mutate: (store: WalletPreferencesStore, input: T) => Promise<WalletPreferences>,
): PreferenceHandler => {
  return async (store, message) => {
    const input = read(message);
    if (input === null) {
      return { error };
    }
    return { ok: true, preferences: await mutate(store, input) };
  };
};

/**
 * Maps a preference message type to its handler. Absent keys return null from
 * {@link handlePreferenceOps} so other operation groups can handle the message.
 */
const PREFERENCE_HANDLERS: Readonly<Record<string, PreferenceHandler>> = {
  "wallet.createGroup": parseThen(readCreateGroupInput, "invalid group request", (store, input) =>
    store.createGroup(input),
  ),
  "wallet.importPreferences": parseThen(
    readImportPreferencesInput,
    "invalid preferences backup",
    (store, input) => store.importPreferences(input.preferences),
  ),
  "wallet.preferences": async (store, message) => {
    if (!readTypeOnlyInput(message, "wallet.preferences")) {
      return { error: "invalid preferences request" };
    }
    return { ok: true, preferences: await store.read() };
  },
  "wallet.removeAddress": parseThen(
    readRemoveAddressInput,
    "invalid address book request",
    (store, input) => store.removeAddress(input.id),
  ),
  "wallet.removeGroup": parseThen(readRemoveGroupInput, "invalid group request", (store, input) =>
    store.removeGroup(input),
  ),
  "wallet.removeNft": parseThen(readRemoveNftInput, "invalid nft request", (store, input) =>
    store.removeNft(input.id),
  ),
  "wallet.renameGroup": parseThen(readRenameGroupInput, "invalid group request", (store, input) =>
    store.renameGroup(input),
  ),
  "wallet.saveAddress": parseThen(
    readSaveAddressInput,
    "invalid address book request",
    (store, input) => store.saveAddress(input),
  ),
  "wallet.setAccountInGroup": parseThen(
    readSetAccountInGroupInput,
    "invalid group request",
    (store, input) => store.setAccountInGroup(input),
  ),
  "wallet.setAccountLabel": parseThen(
    readSetAccountLabelInput,
    "invalid account label request",
    (store, input) => store.setAccountLabel(input),
  ),
  "wallet.setDisplay": parseThen(readSetDisplayInput, "invalid display request", (store, input) =>
    store.setDisplay(input),
  ),
  "wallet.setExplorerFallback": parseThen(
    readSetExplorerFallbackInput,
    "invalid explorer fallback request",
    (store, input) => store.setExplorerFallback(input),
  ),
  "wallet.setGroupIcon": parseThen(readSetGroupIconInput, "invalid group request", (store, input) =>
    store.setGroupIcon(input),
  ),
  "wallet.setNftIndexerUrl": parseThen(
    readSetNftIndexerUrlInput,
    "invalid indexer endpoint request",
    (store, input) => store.setNftIndexerUrl(input),
  ),
  "wallet.setNftSpam": parseThen(readSetNftSpamInput, "invalid nft request", (store, input) =>
    store.setNftSpam(input),
  ),
  "wallet.setRpcOverride": parseThen(
    readSetRpcOverrideInput,
    "invalid rpc override request",
    (store, input) => store.setRpcOverride(input),
  ),
  "wallet.setStrk20NetworkConfig": parseThen(
    readSetStrk20NetworkConfigInput,
    "invalid strk20 service configuration",
    (store, input) => store.setStrk20NetworkConfig(input),
  ),
};

/**
 * Handles preference messages; returns null for other message types.
 */
export const handlePreferenceOps = async (
  preferencesStore: WalletPreferencesStore,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const handler = Object.hasOwn(PREFERENCE_HANDLERS, messageType)
    ? PREFERENCE_HANDLERS[messageType]
    : undefined;
  return handler ? handler(preferencesStore, message) : null;
};
