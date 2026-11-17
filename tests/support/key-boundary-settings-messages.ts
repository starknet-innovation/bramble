/**
 * Read-only settings and support requests in the key-boundary scan: the
 * preferences read, the local diagnostics report, and the feature-flag
 * snapshot. Each answers live for an extension page and must never carry key
 * material.
 */
import { extensionSender } from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/** Settings/support requests included in the exhaustive background message scan. */
export const SETTINGS_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  { message: { type: "wallet.preferences" }, sender: extensionSender },
  { message: { type: "wallet.diagnostics" }, sender: extensionSender },
  { message: { type: "wallet.featureFlags" }, sender: extensionSender },
  {
    message: { key: "swap.enabled", type: "wallet.setFeatureFlagOverride", value: false },
    sender: extensionSender,
  },
  { message: { type: "wallet.clearFeatureFlagOverrides" }, sender: extensionSender },
];
