/** Browser lifecycle wiring for side-panel refreshes. */

import { isWalletEventMessage } from "@mc-wallet/wallet-protocol/events";
import type { WalletStatus } from "../../../popup/responses/responses";
import {
  type TransactionAlertReader,
  withTransactionAlerts,
} from "../../journeys/approvals/tx-alerts-ui";
import type { RuntimeApi } from "../../runtime/runtime";
import { createRefreshScheduler } from "./refresh-scheduler";

type RefreshLifecycleOptions = {
  readonly mutationRuntime: { readonly setListener: (listener: () => void) => void };
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly runtime: RuntimeApi | undefined;
  readonly wallet: TransactionAlertReader & { readonly loadStatus: () => Promise<WalletStatus> };
};

/**
 * Starts event-driven and ambient refreshes for the visible wallet surface.
 */
export const startRefreshLifecycle = ({
  mutationRuntime,
  render,
  runtime,
  wallet,
}: RefreshLifecycleOptions): void => {
  const scheduler = createRefreshScheduler({
    refresh: withTransactionAlerts(document, wallet, async () => render(await wallet.loadStatus())),
    visible: () => document.visibilityState === "visible",
  });
  mutationRuntime.setListener(scheduler.afterAction);
  runtime?.onMessage?.addListener((message) => {
    if (isWalletEventMessage(message)) scheduler.afterAction();
  });
  document.addEventListener("visibilitychange", scheduler.visibilityChanged);
  window.addEventListener("focus", () => {
    scheduler.start();
    scheduler.afterAction();
  });
  window.addEventListener("pagehide", scheduler.stop, { once: true });
  scheduler.start();
};
