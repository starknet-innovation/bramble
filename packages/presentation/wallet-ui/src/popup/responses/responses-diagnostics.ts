/**
 * Validator for the privacy-safe support diagnostics export. Split from
 * ./responses so that file stays within the size budget; the shape is the
 * background's `supportDiagnosticsResponse`, every row an aggregate of fixed
 * labels and numbers.
 */

import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";

/** Identifier-free support report the user may download and share manually. */
export type SupportDiagnostics = {
  readonly accountCount: number;
  readonly collectionEnabled: boolean;
  readonly explorer: readonly {
    readonly count: number;
    readonly latencyMs: number;
    readonly outcome:
      | "http-error"
      | "invalid-response"
      | "ok"
      | "rate-limited"
      | "timeout"
      | "transport-error";
    readonly service: "starkscan";
  }[];
  readonly hasVault: boolean;
  readonly locked: boolean;
  readonly networkId: string;
  /** Tracked privacy jobs by kind, phase label, and outcome class. */
  readonly privacy: readonly {
    readonly count: number;
    readonly durationMs: number;
    readonly kind: "deposit" | "execute" | "register";
    readonly outcome: "error" | "locked" | "ok" | "timeout" | "unavailable";
    readonly phase: string;
  }[];
  readonly ready: boolean;
  readonly rpc: readonly {
    readonly count: number;
    readonly endpoint: "custom" | "foundation" | "wallet-gateway";
    readonly latencyMs: number;
    readonly outcome: "ok" | "rate-limited" | "timeout" | "transport-error";
  }[];
  /** Local store writes that trimmed rows to fit their budget, or failed. */
  readonly storage: readonly {
    readonly count: number;
    readonly outcome: "trimmed" | "write-failed";
    readonly store: "activity";
  }[];
};

// A phase label is one of the fixed strings the background's job registry
// emits (plus "job" for the whole run); bounded here rather than enumerated so
// the popup does not carry a second copy of that vocabulary.
const isPrivacyDiagnosticRow = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["count", "durationMs", "kind", "outcome", "phase"]) &&
  Number.isInteger(value["count"]) &&
  Number.isInteger(value["durationMs"]) &&
  (value["kind"] === "deposit" || value["kind"] === "execute" || value["kind"] === "register") &&
  ["error", "locked", "ok", "timeout", "unavailable"].includes(String(value["outcome"])) &&
  typeof value["phase"] === "string" &&
  value["phase"].length > 0 &&
  value["phase"].length <= 64;

const isExplorerDiagnosticRow = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["count", "latencyMs", "outcome", "service"]) &&
  Number.isInteger(value["count"]) &&
  Number.isInteger(value["latencyMs"]) &&
  value["service"] === "starkscan" &&
  ["http-error", "invalid-response", "ok", "rate-limited", "timeout", "transport-error"].includes(
    String(value["outcome"]),
  );

const isRpcDiagnosticRow = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["count", "endpoint", "latencyMs", "outcome"]) &&
  Number.isInteger(value["count"]) &&
  (value["endpoint"] === "custom" ||
    value["endpoint"] === "foundation" ||
    value["endpoint"] === "wallet-gateway") &&
  Number.isInteger(value["latencyMs"]) &&
  (value["outcome"] === "ok" ||
    value["outcome"] === "rate-limited" ||
    value["outcome"] === "timeout" ||
    value["outcome"] === "transport-error");

const isStorageDiagnosticRow = (value: unknown): boolean =>
  isRecord(value) &&
  hasOnlyKnownKeys(value, ["count", "outcome", "store"]) &&
  Number.isInteger(value["count"]) &&
  value["store"] === "activity" &&
  (value["outcome"] === "trimmed" || value["outcome"] === "write-failed");

/** Validates the exact privacy-safe support diagnostic wire shape. */
export const isSupportDiagnosticsResponse = (
  value: unknown,
): value is { readonly diagnostics: SupportDiagnostics; readonly ok: true } => {
  if (
    !isRecord(value) ||
    !hasOnlyKnownKeys(value, ["diagnostics", "ok"]) ||
    value["ok"] !== true ||
    !isRecord(value["diagnostics"])
  ) {
    return false;
  }
  const diagnostics = value["diagnostics"];
  return (
    hasOnlyKnownKeys(diagnostics, [
      "accountCount",
      "collectionEnabled",
      "explorer",
      "hasVault",
      "locked",
      "networkId",
      "privacy",
      "ready",
      "rpc",
      "storage",
    ]) &&
    Number.isInteger(diagnostics["accountCount"]) &&
    typeof diagnostics["collectionEnabled"] === "boolean" &&
    Array.isArray(diagnostics["explorer"]) &&
    diagnostics["explorer"].every(isExplorerDiagnosticRow) &&
    typeof diagnostics["hasVault"] === "boolean" &&
    typeof diagnostics["locked"] === "boolean" &&
    typeof diagnostics["networkId"] === "string" &&
    Array.isArray(diagnostics["privacy"]) &&
    diagnostics["privacy"].every(isPrivacyDiagnosticRow) &&
    typeof diagnostics["ready"] === "boolean" &&
    Array.isArray(diagnostics["rpc"]) &&
    diagnostics["rpc"].every(isRpcDiagnosticRow) &&
    Array.isArray(diagnostics["storage"]) &&
    diagnostics["storage"].every(isStorageDiagnosticRow)
  );
};
