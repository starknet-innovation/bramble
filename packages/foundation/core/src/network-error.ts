/**
 * Maps low-level fetch/RPC transport failures to a single friendly, actionable
 * line so the UI never surfaces raw strings like "Failed to fetch". Pure and
 * side-effect free; see the colocated package test.
 */

/**
 * User-facing copy shown when the wallet cannot reach the network or RPC.
 */
export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the network. Check your connection or RPC endpoint.";

/**
 * The background's own reply when a live chain read it depends on cannot reach
 * the node: already a reader's sentence, so the panel shows it as written. One
 * definition for every reply that uses it (token scans, token metadata, the
 * Braavos Ledger activity check), so the wording cannot drift between them.
 */
export const NETWORK_RETRY_MESSAGE = "Couldn't reach the network, try again";

const NETWORK_FAILURE_MARKERS = [
  "failed to fetch",
  "fetch failed",
  "network request failed",
  "networkerror",
  "load failed",
  "err_network",
  "err_internet_disconnected",
  "err_name_not_resolved",
  "econnrefused",
  "enotfound",
  "etimedout",
  "timed out",
  "network timeout",
  "socket hang up",
] as const;

/**
 * Returns the friendly network-error line when `raw` looks like a transport
 * failure (unreachable RPC, dropped connection, DNS/timeout), or null when the
 * message is a domain error that should be shown as-is.
 */
export const friendlyNetworkError = (raw: string): string | null => {
  const normalized = raw.toLowerCase();
  return NETWORK_FAILURE_MARKERS.some((marker) => normalized.includes(marker))
    ? NETWORK_ERROR_MESSAGE
    : null;
};
