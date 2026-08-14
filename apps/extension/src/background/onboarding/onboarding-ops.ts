/** Privileged read-only first-run account derivation and mnemonic checks. */
import {
  readPreviewAccountInput,
  readValidateMnemonicInput,
} from "../accounts/account-creation-inputs";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { RuntimeResponse } from "../runtime/runtime-types";

/**
 * Handles read-only public account preview and Krusty mnemonic validation.
 * Returns null for unrelated messages and fails closed when the wallet surface
 * is unavailable; neither path persists or echoes secret material.
 */
export const handleOnboardingOps = async (
  wallet: WalletStatusReader,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.previewAccount") {
    const input = readPreviewAccountInput(message);
    if (!input) {
      return { error: "invalid account preview request" };
    }
    if (!wallet.previewAccount) {
      return { error: "wallet unavailable" };
    }
    return { account: await wallet.previewAccount(input), ok: true };
  }
  if (messageType !== "wallet.validateMnemonic") {
    return null;
  }
  const input = readValidateMnemonicInput(message);
  if (!input) {
    return { error: "invalid mnemonic validation request" };
  }
  if (!wallet.validateMnemonic) {
    return { error: "wallet unavailable" };
  }
  return { ok: true, valid: await wallet.validateMnemonic(input.mnemonic) };
};
