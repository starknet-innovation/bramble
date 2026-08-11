/** Ambient repaint guard for an in-flight Send journey. */
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { actionableApprovals } from "../approvals/approval-screen";

const IN_FLIGHT_TRANSFER_STAGES: ReadonlySet<string> = new Set([
  "authorizing",
  "broadcasting",
  "confirming",
  "reviewing",
]);

/**
 * Keeps the live Send DOM authoritative during submission. A lock, account
 * switch, navigation, or unsnoozed external request always supersedes it.
 */
export const shouldPreserveTransferSurface = (
  app: Element | null,
  activeView: string,
  status: WalletStatus,
  pending: readonly PendingApproval[],
  snoozedIds: readonly string[],
): boolean => {
  if (
    activeView !== "send" ||
    !status.hasVault ||
    status.locked ||
    actionableApprovals(pending, snoozedIds).length > 0
  ) {
    return false;
  }
  const form = app?.querySelector<HTMLFormElement>("#transfer-form");
  const accountId = form?.querySelector<HTMLInputElement>('[name="accountId"]')?.value;
  return (
    accountId === status.activeAccountId &&
    IN_FLIGHT_TRANSFER_STAGES.has(form?.dataset["stage"] ?? "")
  );
};
