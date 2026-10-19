/**
 * Panel client for "Unlock private transactions" (mc-wallet 668).
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { responseError } from "../../runtime/runtime-errors";

/**
 * Creates the unlock client. `releasePendingPrivateWrite` asks the background
 * to clear the active account's paused private write and resolves whether one
 * was cleared. Any other answer rejects, so the panel never reports an unlock
 * that did not happen.
 */
export const createPrivacyUnlockClient = (sendMessage: (message: unknown) => Promise<unknown>) => ({
  async releasePendingPrivateWrite(): Promise<boolean> {
    const response = await sendMessage({ type: "wallet.strk20ReleasePendingWrite" });
    if (
      isRecord(response) &&
      hasOnlyKnownKeys(response, ["ok", "released"]) &&
      response["ok"] === true &&
      typeof response["released"] === "boolean"
    ) {
      return response["released"];
    }
    throw responseError(response, "Private unlock failed");
  },
});
