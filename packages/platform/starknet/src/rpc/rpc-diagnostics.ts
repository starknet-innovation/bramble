/** Privacy-safe, process-local network reliability counters. */

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

/** Explorer API outcomes stay separate from Starknet JSON-RPC outcomes. */
export type ExplorerOutcome =
  | "http-error"
  | "invalid-response"
  | "ok"
  | "rate-limited"
  | "timeout"
  | "transport-error";

/** One identifier-free aggregate for the optional explorer fallback lane. */
export type ExplorerDiagnosticRow = {
  readonly count: number;
  readonly latencyMs: number;
  readonly outcome: ExplorerOutcome;
  readonly service: "starkscan";
};

const rows = new Map<string, RpcDiagnosticRow>();
const explorerRows = new Map<string, ExplorerDiagnosticRow>();
let enabled = false;

/** Enables or clears process-local reliability counters. No diagnostic is transmitted. */
export const setReliabilityDiagnosticsEnabled = (next: boolean): void => {
  enabled = next;
  if (!next) {
    rows.clear();
    explorerRows.clear();
  }
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

/** Records one explorer API result without mixing it into RPC request counts. */
export const recordExplorerDiagnostic = (
  service: ExplorerDiagnosticRow["service"],
  outcome: ExplorerOutcome,
  latencyMs: number,
): void => {
  if (!enabled) return;
  const key = `${service}:${outcome}`;
  const previous = explorerRows.get(key);
  const count = (previous?.count ?? 0) + 1;
  explorerRows.set(key, {
    count,
    latencyMs: Math.round(((previous?.latencyMs ?? 0) * (count - 1) + latencyMs) / count),
    outcome,
    service,
  });
};

/** Returns explorer-only aggregates; RPC calls are never included. */
export const explorerDiagnosticsSnapshot = (): readonly ExplorerDiagnosticRow[] =>
  [...explorerRows.values()].sort((left, right) =>
    `${left.service}:${left.outcome}`.localeCompare(`${right.service}:${right.outcome}`),
  );
