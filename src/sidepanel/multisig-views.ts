/**
 * Pure multisig screen templates: the watched-multisig list with add and
 * deploy entries, a multisig detail screen with signers and tracked
 * proposals, the propose form, and the deploy form. Logic-free string
 * builders; all bindings live in multisig-ui.ts.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { sameFelt } from "../starknet/networks";
import type { MultisigProposalRecord, MultisigRecord } from "../storage/multisig-store";
import type { WalletPreferences } from "../storage/preferences-store";
import type { AccountRef } from "../storage/vault-schema";
import { emptyState, pill } from "../ui/content";
import { button } from "../ui/controls";
import { menuRow } from "../ui/navigation";
import { multisigDisplayName } from "./multisig-model";
import {
  EMPTY_MULTISIG_PORTFOLIO,
  type MultisigPortfolioData,
  multisigPortfolio,
} from "./multisig-portfolio";
import { multisigProposalList } from "./multisig-proposal-view";
import {
  accountLabel,
  copyButton,
  flowHeader,
  flowScreen,
  hardwareBadge,
  noAccountEmpty,
  walletMenuRow,
} from "./parts";

export { multisigDeployFlow } from "./multisig-deploy-view";
export { multisigDisplayName } from "./multisig-model";
export { multisigProposeFlow } from "./multisig-propose-view";

const multisigRow = (record: MultisigRecord, pendingCount: number): string => `
  <li class="allowance-row">
    ${menuRow({
      attributes: { "data-multisig-open": record.id },
      icon: "wallet",
      label: multisigDisplayName(record),
      supportingText: `${record.quorum} of ${record.signers.length} signers${pendingCount > 0 ? ` · ${pendingCount} open` : ""}`,
    })}
  </li>`;

const multisigSyncNotice = (
  loadError: boolean,
  sync: "current" | "error" | null,
  retryId: string,
): string => {
  if (loadError || sync === "error") {
    return `<div class="review-panel" role="alert">
      <p class="review-flag">Could not refresh multisig state from the background or chain. Cached data may be stale.</p>
      ${button({
        attributes: { id: retryId },
        icon: "refresh",
        label: "Retry",
        size: "small",
        variant: "secondary",
      })}
      </div>`;
  }
  return "";
};

/**
 * Renders the Multisigs overview. Watching and deployment are dedicated tasks
 * reached through the compact action group.
 */
export const multisigsFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  multisigs: readonly MultisigRecord[],
  proposals: readonly MultisigProposalRecord[],
  loadError = false,
  sync: "current" | "error" | null = null,
): string => {
  const scoped = multisigs.filter((record) => record.networkId === status.networkId);
  const openCount = (record: MultisigRecord): number =>
    proposals.filter(
      (proposal) => proposal.multisigId === record.id && proposal.state !== "executed",
    ).length;
  return (
    flowHeader("Multisigs", status, `${scoped.length} watched`) +
    flowScreen(
      "multisigs",
      `${multisigSyncNotice(loadError, sync, "multisig-list-retry")}
      <section class="section">
        <div class="menu-list" role="group" aria-label="Multisig actions">
          ${walletMenuRow("multisig-watch", "Watch by address", "plus")}
          ${walletMenuRow("multisig-deploy", "Deploy new multisig", "users")}
        </div>
      </section>
      <section class="section">
        <p class="eyebrow">Watched multisigs</p>
        ${
          account === null
            ? noAccountEmpty(status)
            : scoped.length === 0
              ? emptyState("No multisigs are watched on this network yet.")
              : `<ul class="allowance-list">${scoped.map((record) => multisigRow(record, openCount(record))).join("")}</ul>`
        }
        <p id="multisig-list-result" role="status"></p>
      </section>`,
    )
  );
};

/**
 * Renders one signer with local-account and Ledger provenance badges.
 */
export const multisigSignerRow = (
  signer: string,
  account: AccountRef | null,
  accounts: readonly AccountRef[],
): string => {
  // Badge a signer that is a Ledger account in THIS wallet, so a co-signer can
  // see at a glance which signers are hardware-backed here.
  const local = accounts.find((stored) => sameFelt(stored.address, signer));
  return `
  <li class="address-line">
    <code>${escapeHtml(accountLabel(signer))}</code>
    ${account && sameFelt(signer, account.address) ? pill("You") : ""}
    ${local ? hardwareBadge(local) : ""}
    ${copyButton(signer, "Copy signer address")}
  </li>`;
};

/**
 * Renders one multisig's detail screen: on-chain config, tracked proposals
 * with lifecycle actions, and the track-by-id form.
 */
export const multisigDetailFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  record: MultisigRecord | null,
  proposals: readonly MultisigProposalRecord[],
  loadError = false,
  sync: "current" | "error" | null = null,
  preferences: WalletPreferences | null = null,
  view: "multisig-detail" | "multisig-home" = "multisig-detail",
  portfolio: MultisigPortfolioData = EMPTY_MULTISIG_PORTFOLIO,
): string => {
  if (!record) {
    return (
      flowHeader("Multisig", status) +
      flowScreen(
        view,
        loadError
          ? multisigSyncNotice(true, "error", "multisig-list-retry")
          : emptyState("This multisig is no longer watched."),
      )
    );
  }
  const tracked = proposals.filter((proposal) => proposal.multisigId === record.id);
  const canSign =
    account !== null && record.signers.some((signer) => sameFelt(signer, account.address));
  const openCount = tracked.filter((proposal) => proposal.state !== "executed").length;
  return (
    flowHeader(
      multisigDisplayName(record),
      status,
      `${record.quorum} of ${record.signers.length} signers`,
    ) +
    flowScreen(
      view,
      `${multisigSyncNotice(loadError, sync, "multisig-list-retry")}
      ${multisigPortfolio({
        canSign,
        data: portfolio,
        openCount,
        preferences,
        proposals: `${multisigProposalList(record, tracked, canSign, account, preferences)}
          <p id="multisig-proposal-result" role="status"></p>`,
        record,
      })}
      <p id="multisig-detail-result" role="status"></p>`,
    )
  );
};
