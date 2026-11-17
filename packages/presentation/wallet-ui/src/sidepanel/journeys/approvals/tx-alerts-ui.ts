/**
 * Delivery of background transaction failure notices to the side panel.
 *
 * A transaction can fail after the user has left the Send screen — a
 * pre-confirmed transaction whose block never commits, or an accepted one
 * dropped by a later reorg. The background records a notice on the activity
 * entry when that happens, including while this panel was closed; this module
 * drains those notices on every ambient refresh and toasts them, so the outcome
 * reaches the user on next open rather than only appearing as a changed row in
 * the activity feed.
 */
import { showNoticeToast } from "../../shared/dom";

/**
 * The runtime surface this needs. Declared structurally so the binding does not
 * depend on the whole side-panel wallet client.
 */
export type TransactionAlertReader = {
  readonly loadTransactionAlerts: () => Promise<readonly string[]>;
};

/**
 * Wraps a refresh so each run also drains and shows any owed failure notices.
 *
 * The wrapped refresh runs first, so alert delivery can never mask or delay a
 * state refresh, and a failed drain is swallowed rather than breaking the poll
 * loop. Delivery is at-most-once: the background marks a notice delivered when
 * it hands it over, so a panel that dies between the response and the toast
 * loses that toast. The activity entry still carries the correct terminal
 * status either way, which is the durable record.
 */
export const withTransactionAlerts =
  (
    context: Document | Element | null,
    wallet: TransactionAlertReader,
    refresh: () => Promise<void>,
  ): (() => Promise<void>) =>
  async () => {
    await refresh();
    const alerts = await wallet.loadTransactionAlerts().catch(() => []);
    // Each alert is a sentence the background wrote, quoting the entry's
    // summary, so it is shown as written rather than mapped by its words.
    for (const alert of alerts) {
      showNoticeToast(alert, context);
    }
  };
