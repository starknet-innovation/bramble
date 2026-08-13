/** Privileged read-only first-run account derivation. */
import { readPreviewAccountInput } from "../accounts/account-creation-inputs";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { RuntimeResponse } from "../runtime/runtime-types";

/**
 * Handles read-only public account preview. Returns null for unrelated
 * messages and fails closed when derivation is unavailable; it never persists.
 */
export const handleOnboardingOps = async (
  wallet: WalletStatusReader,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType !== "wallet.previewAccount") {
    return null;
  }
  const input = readPreviewAccountInput(message);
  if (!input) {
    return { error: "invalid account preview request" };
  }
  if (!wallet.previewAccount) {
    return { error: "wallet unavailable" };
  }
  return { account: await wallet.previewAccount(input), ok: true };
};
