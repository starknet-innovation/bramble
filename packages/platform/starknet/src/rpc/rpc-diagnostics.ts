/** Privacy-safe, process-local RPC reliability counters. */

/** Endpoint classes exposed in a diagnostic export. Exact URLs never leave the transport. */
export type RpcEndpointClass = "custom" | "foundation" | "wallet-gateway";

/** Fixed outcomes exposed in a diagnostic export. Error messages and bodies are never retained. */
export type RpcOutcome = "ok" | "rate-limited" | "timeout" | "transport-error";

/** One bounded aggregate row in a local diagnostic export. */
export type RpcDiagnosticRow = {
  readonly count: number;
  readonly endpoint: RpcEndpointClass;
  readonly latencyMs: number;
  readonly outcome: RpcOutcome;
};

const rows = new Map<string, RpcDiagnosticRow>();
let enabled = false;

/** Enables or clears process-local reliability counters. No diagnostic is transmitted. */
export const setRpcDiagnosticsEnabled = (next: boolean): void => {
  enabled = next;
  if (!next) rows.clear();
};

/** Classifies an endpoint without retaining its URL, host, path, or request. */
export const rpcEndpointClass = (input: RequestInfo | URL): RpcEndpointClass => {
  try {
    const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
    if (host === "wallet.nodes.starknet.org") return "wallet-gateway";
    if (host.endsWith(".nodes.starknet.org") || host === "api.cartridge.gg") return "foundation";
  } catch {
    // An invalid request URL will fail in fetch; it is still safe to classify as custom.
  }
  return "custom";
};

/** Records one transport result as fixed-category aggregate data only. */
export const recordRpcDiagnostic = (
  endpoint: RpcEndpointClass,
  outcome: RpcOutcome,
  latencyMs: number,
): void => {
  if (!enabled) return;
  const key = `${endpoint}:${outcome}`;
  const previous = rows.get(key);
  const count = (previous?.count ?? 0) + 1;
  rows.set(key, {
    count,
    endpoint,
    latencyMs: Math.round(((previous?.latencyMs ?? 0) * (count - 1) + latencyMs) / count),
    outcome,
  });
};

/** Returns the complete bounded local snapshot; no wallet or request identifier is present. */
export const rpcDiagnosticsSnapshot = (): readonly RpcDiagnosticRow[] =>
  [...rows.values()].sort((left, right) =>
    `${left.endpoint}:${left.outcome}`.localeCompare(`${right.endpoint}:${right.outcome}`),
  );
