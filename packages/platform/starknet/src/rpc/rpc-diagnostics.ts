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

/** Which tracked STRK20 background job a privacy row belongs to. */
export type PrivacyJobKind = "deposit" | "execute" | "register";

/**
 * Fixed outcomes of one phase of a privacy job, or of the whole job (`phase`
 * `"job"`). Derived from the job's settled response by class only; the
 * response text itself is never retained.
 */
export type PrivacyOutcome = "error" | "locked" | "ok" | "timeout" | "unavailable";

/**
 * One identifier-free aggregate for the privacy-job lane: how often a job of
 * this kind spent time in this phase with this outcome, and for how long on
 * average. Phases are the fixed labels of `@bramble/privacy/phases` plus
 * `"job"` for the whole run; nothing about the account, its notes, or the
 * amounts reaches this row.
 */
export type PrivacyDiagnosticRow = {
  readonly count: number;
  readonly durationMs: number;
  readonly kind: PrivacyJobKind;
  readonly outcome: PrivacyOutcome;
  readonly phase: string;
};

/** Local stores whose write outcomes a diagnostic export counts. */
export type StorageDiagnosticStore = "activity";

/**
 * Fixed outcomes of one local store write: rows were evicted so the value fits
 * its storage budget, or the write itself failed. Error text is never kept.
 */
export type StorageOutcome = "trimmed" | "write-failed";

/** One identifier-free aggregate of local store writes. */
export type StorageDiagnosticRow = {
  readonly count: number;
  readonly outcome: StorageOutcome;
  readonly store: StorageDiagnosticStore;
};

// A phase label longer than this is not one of the fixed labels; it is
// dropped rather than aggregated under a name the export was not designed for.
const MAX_PHASE_LABEL = 64;

const rows = new Map<string, RpcDiagnosticRow>();
const explorerRows = new Map<string, ExplorerDiagnosticRow>();
const privacyRows = new Map<string, PrivacyDiagnosticRow>();
const storageRows = new Map<string, StorageDiagnosticRow>();
let enabled = false;

/** Enables or clears process-local reliability counters. No diagnostic is transmitted. */
export const setReliabilityDiagnosticsEnabled = (next: boolean): void => {
  enabled = next;
  if (!next) {
    rows.clear();
    explorerRows.clear();
    privacyRows.clear();
    storageRows.clear();
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

/**
 * Records one phase (or whole-job) outcome of a tracked privacy job as
 * aggregate data only. Off unless the user enabled reliability diagnostics.
 */
export const recordPrivacyDiagnostic = (
  kind: PrivacyJobKind,
  phase: string,
  outcome: PrivacyOutcome,
  durationMs: number,
): void => {
  if (!enabled || phase.length === 0 || phase.length > MAX_PHASE_LABEL) return;
  const key = `${kind}:${phase}:${outcome}`;
  const previous = privacyRows.get(key);
  const count = (previous?.count ?? 0) + 1;
  privacyRows.set(key, {
    count,
    durationMs: Math.round(((previous?.durationMs ?? 0) * (count - 1) + durationMs) / count),
    kind,
    outcome,
    phase,
  });
};

/** Returns privacy-job aggregates; neither RPC nor explorer calls are included. */
export const privacyDiagnosticsSnapshot = (): readonly PrivacyDiagnosticRow[] =>
  [...privacyRows.values()].sort((left, right) =>
    `${left.kind}:${left.phase}:${left.outcome}`.localeCompare(
      `${right.kind}:${right.phase}:${right.outcome}`,
    ),
  );

/**
 * Counts one local store write that trimmed rows or failed. Callers that
 * absorb a write failure so it cannot replace a chain outcome still leave this
 * trace; off unless the user enabled reliability diagnostics.
 */
export const recordStorageDiagnostic = (
  store: StorageDiagnosticStore,
  outcome: StorageOutcome,
): void => {
  if (!enabled) return;
  const key = `${store}:${outcome}`;
  storageRows.set(key, { count: (storageRows.get(key)?.count ?? 0) + 1, outcome, store });
};

/** Returns local store write aggregates; no network call is included. */
export const storageDiagnosticsSnapshot = (): readonly StorageDiagnosticRow[] =>
  [...storageRows.values()].sort((left, right) =>
    `${left.store}:${left.outcome}`.localeCompare(`${right.store}:${right.outcome}`),
  );
