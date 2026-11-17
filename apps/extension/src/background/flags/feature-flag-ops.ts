/**
 * `wallet.featureFlags`: the only way an extension page reads feature flags.
 *
 * Privileged (extension pages only, by the router's deny-by-default rule) and
 * deliberately absent from `DAPP_MESSAGES`. Read-only: it never refreshes,
 * never mutates, and answers the effective booleans for the active chain plus
 * their source. It returns no bucket, document, or URL.
 */
import { isStarknetNetworkId } from "@bramble/wallet-model/networks";
import type { RouterContext } from "../routing/message-context";
import { readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeResponse } from "../runtime/runtime-types";

const activeChain = async (
  ctx: Pick<RouterContext, "preferencesStore">,
): Promise<string | null> => {
  try {
    const { activeNetworkId } = await ctx.preferencesStore.read();
    return isStarknetNetworkId(activeNetworkId) ? activeNetworkId : null;
  } catch {
    // Unknown chain: chain-targeted rules simply do not match.
    return null;
  }
};

/** Handles `wallet.featureFlags`; returns null for every other message type. */
export const handleFeatureFlagOps = async (
  ctx: Pick<RouterContext, "featureFlags" | "preferencesStore">,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType !== "wallet.featureFlags") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.featureFlags")) {
    return { error: "invalid feature flags request" };
  }
  const snapshot = await ctx.featureFlags.snapshot(await activeChain(ctx));
  return { ...snapshot, ok: true };
};
