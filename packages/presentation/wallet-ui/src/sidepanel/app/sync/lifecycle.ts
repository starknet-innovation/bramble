/** Browser lifecycle wiring for side-panel refreshes. */

import { isWalletEventMessage } from "@bramble/wallet-protocol/events";
import type { WalletStatus } from "../../../popup/responses/responses";
import {
  type TransactionAlertReader,
  withTransactionAlerts,
} from "../../journeys/approvals/tx-alerts-ui";
import type { RuntimeApi, RuntimeMessageSender } from "../../runtime/runtime";
import { createRefreshScheduler, type RefreshReason } from "./refresh-scheduler";
import type { MutationRefresh } from "./runtime-refresh";

type RefreshLifecycleOptions = {
  readonly mutationRuntime: {
    readonly setListener: (listener: (refresh: MutationRefresh) => void) => void;
  };
  readonly render: (status: WalletStatus, refreshReason?: RefreshReason) => Promise<void>;
  readonly runtime: RuntimeApi | undefined;
  readonly wallet: TransactionAlertReader & { readonly loadStatus: () => Promise<WalletStatus> };
};

/**
 * Accepts refresh events only from an extension context without a sender tab.
 * Content scripts always carry tab evidence and may forge message payloads.
 */
export const isBackgroundWalletEvent = (
  message: unknown,
  sender: RuntimeMessageSender | undefined,
): boolean => sender !== undefined && sender.tab === undefined && isWalletEventMessage(message);

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
    refresh: (reason) =>
      withTransactionAlerts(document, wallet, async () =>
        render(await wallet.loadStatus(), reason),
      )(),
    visible: () => document.visibilityState === "visible",
  });
  mutationRuntime.setListener((refresh) => {
    if (refresh === "burst") scheduler.afterAction();
    else scheduler.refreshNow();
  });
  runtime?.onMessage?.addListener((message, sender) => {
    if (isBackgroundWalletEvent(message, sender)) scheduler.refreshNow();
  });
  document.addEventListener("visibilitychange", scheduler.visibilityChanged);
  window.addEventListener("pagehide", scheduler.stop, { once: true });
  scheduler.start();
};
