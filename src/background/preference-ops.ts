/**
 * Preference operations dispatched from the background message handler:
 * address book management, account labels, display settings, RPC overrides,
 * and backup import. All are privileged extension-page messages.
 */
import type { WalletPreferencesStore } from "../storage/preferences-store";
import {
  readImportPreferencesInput,
  readRemoveAddressInput,
  readSaveAddressInput,
  readSetAccountLabelInput,
  readSetDisplayInput,
  readSetRpcOverrideInput,
  readTypeOnlyInput,
} from "./message-inputs";
import type { RuntimeResponse } from "./runtime-types";

/**
 * Handles preference messages; returns null for other message types.
 */
export const handlePreferenceOps = async (
  preferencesStore: WalletPreferencesStore,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.preferences") {
    if (!readTypeOnlyInput(message, "wallet.preferences")) {
      return { error: "invalid preferences request" };
    }
    return { ok: true, preferences: await preferencesStore.read() };
  }

  if (messageType === "wallet.saveAddress") {
    const input = readSaveAddressInput(message);
    if (!input) {
      return { error: "invalid address book request" };
    }
    return { ok: true, preferences: await preferencesStore.saveAddress(input) };
  }

  if (messageType === "wallet.removeAddress") {
    const input = readRemoveAddressInput(message);
    if (!input) {
      return { error: "invalid address book request" };
    }
    return { ok: true, preferences: await preferencesStore.removeAddress(input.id) };
  }

  if (messageType === "wallet.setAccountLabel") {
    const input = readSetAccountLabelInput(message);
    if (!input) {
      return { error: "invalid account label request" };
    }
    return { ok: true, preferences: await preferencesStore.setAccountLabel(input) };
  }

  if (messageType === "wallet.setDisplay") {
    const input = readSetDisplayInput(message);
    if (!input) {
      return { error: "invalid display request" };
    }
    return { ok: true, preferences: await preferencesStore.setDisplay(input) };
  }

  if (messageType === "wallet.setRpcOverride") {
    const input = readSetRpcOverrideInput(message);
    if (!input) {
      return { error: "invalid rpc override request" };
    }
    return { ok: true, preferences: await preferencesStore.setRpcOverride(input) };
  }

  if (messageType === "wallet.importPreferences") {
    const input = readImportPreferencesInput(message);
    if (!input) {
      return { error: "invalid preferences backup" };
    }
    return { ok: true, preferences: await preferencesStore.importPreferences(input.preferences) };
  }

  return null;
};
