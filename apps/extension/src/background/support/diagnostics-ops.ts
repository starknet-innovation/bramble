/**
 * `wallet.diagnostics` routing: input validation in front of the sanitized
 * report in `./diagnostics`. Kept apart from the report builder so the shared
 * response types never depend on the router context (an import cycle).
 */
import type { RouterContext } from "../routing/message-context";
import { readTypeOnlyInput } from "../routing/message-inputs";
import { type SupportDiagnosticsResponse, supportDiagnosticsResponse } from "./diagnostics";

/** Handles `wallet.diagnostics`; returns null for every other message type. */
export const handleDiagnosticsOps = async (
  ctx: Pick<RouterContext, "preferencesStore" | "session" | "wallet">,
  messageType: string,
  message: unknown,
): Promise<SupportDiagnosticsResponse | { readonly error: string } | null> => {
  if (messageType !== "wallet.diagnostics") {
    return null;
  }
  return readTypeOnlyInput(message, "wallet.diagnostics")
    ? supportDiagnosticsResponse(ctx.wallet, ctx.session, ctx.preferencesStore)
    : { error: "invalid diagnostics request" };
};
