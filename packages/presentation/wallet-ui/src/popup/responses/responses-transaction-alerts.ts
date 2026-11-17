/**
 * Transaction-alert response validation at the background-to-panel boundary.
 */
import { hasOnlyKnownKeys, isJson, isRecord } from "@bramble/core/json";
import {
  MAX_TRANSACTION_ALERT_CHARACTERS,
  MAX_TRANSACTION_ALERTS_PER_DRAIN,
} from "@bramble/transactions/alerts";

/**
 * Undelivered transaction failure notices drained from the activity log. Each
 * string is ready-to-show copy and is handed out exactly once.
 */
export type TransactionAlertsResponse = {
  readonly alerts: readonly string[];
  readonly ok: true;
};

/**
 * Checks transaction alert responses before toasting them.
 */
export const isTransactionAlertsResponse = (value: unknown): value is TransactionAlertsResponse =>
  isRecord(value) &&
  isJson(value) &&
  hasOnlyKnownKeys(value, ["alerts", "ok"]) &&
  value["ok"] === true &&
  Array.isArray(value["alerts"]) &&
  value["alerts"].length <= MAX_TRANSACTION_ALERTS_PER_DRAIN &&
  value["alerts"].every(
    (alert) =>
      typeof alert === "string" &&
      alert.length > 0 &&
      alert.length <= MAX_TRANSACTION_ALERT_CHARACTERS,
  );
