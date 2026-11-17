/**
 * Side-panel client for `wallet.featureFlags`: the effective flag values the
 * background evaluated from the bundled catalog and a verified bramble-ff
 * signed flag file: read-only, and used only to decide what the panel shows.
 *
 * Fails closed: a rejected, missing or malformed reply reads as no flags, so
 * every gated feature stays hidden. Only boolean values are kept, and only
 * `true` turns a feature on.
 */
import { isRecord } from "@bramble/core/json";

/** Effective boolean per flag key, as the background answered it. */
export type FeatureFlagValues = Readonly<Record<string, boolean>>;

// The publisher's own bound on how many flags a document may carry.
const MAX_FLAGS = 64;

/** The flag values in a `wallet.featureFlags` reply, or none when it is not one. */
export const readFeatureFlagValues = (response: unknown): FeatureFlagValues => {
  if (!isRecord(response) || response["ok"] !== true || !isRecord(response["flags"])) return {};
  const entries = Object.entries(response["flags"]);
  if (entries.length > MAX_FLAGS) return {};
  return Object.fromEntries(
    entries.filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
};

/** Creates the flag half of the side-panel client over the panel's message transport. */
export const createFeatureFlagRuntimeClient = (
  sendMessage: (message: unknown) => Promise<unknown>,
) => ({
  /** The effective flags; never rejects, and answers none on any failure. */
  async loadFeatureFlags(): Promise<FeatureFlagValues> {
    const response = await sendMessage({ type: "wallet.featureFlags" }).catch(() => null);
    return readFeatureFlagValues(response);
  },
});
