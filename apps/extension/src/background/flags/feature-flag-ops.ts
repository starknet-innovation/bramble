/**
 * Feature-flag messages for extension pages:
 * - `wallet.featureFlags` reads the effective booleans for the active chain,
 *   their source, and which flags are overridable, overridden, or killed. It
 *   never refreshes and returns no bucket, document, or URL.
 * - `wallet.setFeatureFlagOverride` sets or clears one local override, and
 *   `wallet.clearFeatureFlagOverrides` removes them all (Settings >
 *   Experimental features). Both require an unlocked wallet, accept only
 *   catalog flags marked `localOverride`, and answer the fresh snapshot.
 *
 * All three are privileged (extension pages only, by the router's
 * deny-by-default rule) and deliberately absent from `DAPP_MESSAGES`, so a
 * site can neither read nor change flags.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { isStarknetNetworkId } from "@bramble/wallet-model/networks";
import type { RouterContext } from "../routing/message-context";
import { readTypeOnlyInput } from "../routing/message-inputs";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { FeatureFlagOverrideResult } from "./feature-flag-client";

type FlagOpsContext = Pick<RouterContext, "featureFlags" | "preferencesStore" | "session">;

// Bounds the untrusted key before it reaches the catalog lookup.
const MAX_FLAG_KEY_LENGTH = 64;

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

const snapshotResponse = async (ctx: FlagOpsContext): Promise<RuntimeResponse> => {
  const snapshot = await ctx.featureFlags.snapshot(await activeChain(ctx));
  return { ...snapshot, ok: true };
};

const readOverrideInput = (
  message: unknown,
): { readonly key: string; readonly value: boolean | null } | null => {
  if (
    !isRecord(message) ||
    !hasOnlyKnownKeys(message, ["key", "type", "value"]) ||
    message["type"] !== "wallet.setFeatureFlagOverride"
  ) {
    return null;
  }
  const { key, value } = message;
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_FLAG_KEY_LENGTH) {
    return null;
  }
  return typeof value === "boolean" || value === null ? { key, value } : null;
};

const afterWrite = async (
  ctx: FlagOpsContext,
  result: FeatureFlagOverrideResult,
): Promise<RuntimeResponse> => {
  if (result === "not-overridable") {
    return { error: "feature flag not overridable" };
  }
  if (result === "unavailable") {
    return { error: "feature flag overrides unavailable" };
  }
  return snapshotResponse(ctx);
};

/** Handles the feature-flag messages; returns null for every other type. */
export const handleFeatureFlagOps = async (
  ctx: FlagOpsContext,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.featureFlags") {
    if (!readTypeOnlyInput(message, "wallet.featureFlags")) {
      return { error: "invalid feature flags request" };
    }
    return snapshotResponse(ctx);
  }
  if (messageType === "wallet.setFeatureFlagOverride") {
    const input = readOverrideInput(message);
    return overrideWrite(ctx, input !== null, () =>
      ctx.featureFlags.setOverride(input?.key ?? "", input?.value ?? null),
    );
  }
  if (messageType === "wallet.clearFeatureFlagOverrides") {
    return overrideWrite(
      ctx,
      readTypeOnlyInput(message, "wallet.clearFeatureFlagOverrides"),
      ctx.featureFlags.clearOverrides,
    );
  }
  return null;
};

// Shared gate for both override writes: a valid request, then an unlocked
// wallet, then the write itself.
const overrideWrite = async (
  ctx: FlagOpsContext,
  valid: boolean,
  write: () => Promise<FeatureFlagOverrideResult>,
): Promise<RuntimeResponse> => {
  if (!valid) {
    return { error: "invalid feature flag override request" };
  }
  if (!ctx.session.isUnlocked()) {
    return { error: "wallet locked" };
  }
  return afterWrite(ctx, await write());
};
