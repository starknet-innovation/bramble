/** Ambient repaint guard for an in-progress multisig proposal journey. */
import type { PendingApproval, WalletStatus } from "../../../popup/responses/responses";
import { actionableApprovals } from "../approvals/approval-screen";

/**
 * Keeps an actively edited proposal DOM authoritative during polling. Locks,
 * network changes, navigation, and unsnoozed external approvals still replace
 * it immediately; signer membership is revalidated in the background on submit.
 */
export const shouldPreserveMultisigProposalSurface = (
  app: Element | null,
  activeView: string,
  selectedMultisigId: string | null,
  status: WalletStatus,
  pending: readonly PendingApproval[],
  snoozedIds: readonly string[],
): boolean => {
  if (
    activeView !== "multisig-propose" ||
    selectedMultisigId === null ||
    !status.hasVault ||
    status.locked ||
    actionableApprovals(pending, snoozedIds).length > 0
  ) {
    return false;
  }
  const form = app?.querySelector<HTMLFormElement>("#multisig-propose-form");
  if (!form || form.dataset["multisigId"] !== selectedMultisigId) return false;
  const active = form.ownerDocument.activeElement;
  return (
    form.dataset["proposalStage"] !== "recipient" || (active !== null && form.contains(active))
  );
};
