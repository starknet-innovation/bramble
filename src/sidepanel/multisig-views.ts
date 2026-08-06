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
import { icon } from "./icons";
import { multisigDisplayName } from "./multisig-model";
import {
  EMPTY_MULTISIG_PORTFOLIO,
  type MultisigPortfolioData,
  multisigPortfolio,
} from "./multisig-portfolio";
import { multisigProposalList } from "./multisig-proposal-view";
import type { MultisigSyncState } from "./multisig-sync";
import {
  accountLabel,
  copyButton,
  dockScreen,
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
  sync: MultisigSyncState,
  retryId: string,
): string => {
  const retry = button({
    attributes: { id: retryId },
    icon: "refresh",
    label: "Retry",
    size: "small",
    variant: "secondary",
  });
  if (loadError) {
    return `<div class="review-panel" role="alert">
      <p class="review-flag">The wallet background could not load the watched multisig registry. The visible snapshot may be stale.</p>
      <p><code>Support code · MC-MS-REGISTRY</code></p>${retry}
    </div>`;
  }
  if (sync === "configuration-unavailable") {
    return `<div class="review-panel" role="alert">
      <p class="review-flag">The selected network did not return this multisig's current signer and quorum configuration.</p>
      <p><code>Support code · MC-MS-CONFIG-RPC</code></p>${retry}
    </div>`;
  }
  if (sync === "background-unavailable") {
    return `<div class="review-panel" role="alert">
      <p class="review-flag">The wallet background did not complete the multisig refresh.</p>
      <p><code>Support code · MC-MS-BACKGROUND</code></p>${retry}
    </div>`;
  }
  if (sync === "proposal-refresh-incomplete") {
    return `<div class="review-panel" role="status">
      <p>Signer and quorum configuration is current. At least one tracked proposal status remains cached.</p>
      <p><code>Support code · MC-MS-PROPOSALS-RPC</code></p>${retry}
    </div>`;
  }
  if (sync === "proposal-discovery-unavailable") {
    return `<div class="review-panel" role="status">
      <p>Account state and tracked proposals are current. Automatic proposal search is temporarily unavailable; you can still add a proposal by id.</p>
      <p><code>Support code · MC-MS-DISCOVERY-RPC</code></p>${retry}
    </div>`;
  }
  if (sync === "proposal-discovery-recent") {
    return `<div class="multisig-sync-meta">
      <details class="multisig-sync-info">
        <summary aria-label="About proposal search coverage" title="About proposal search coverage">
          ${icon("info")}<span class="multisig-sync-tooltip" role="tooltip">Proposal search coverage</span>
        </summary>
        <div class="multisig-sync-popover" role="note">
          <strong>Recent proposals checked</strong>
          <p>To review an older proposal, add its proposal id.</p>
        </div>
      </details>
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
  sync: MultisigSyncState = null,
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
  sync: MultisigSyncState = null,
  preferences: WalletPreferences | null = null,
  view: "multisig-detail" | "multisig-home" = "multisig-detail",
  portfolio: MultisigPortfolioData = EMPTY_MULTISIG_PORTFOLIO,
): string => {
  if (!record) {
    return (
      (view === "multisig-home" ? "" : flowHeader("Multisig", status)) +
      (view === "multisig-home" ? dockScreen : flowScreen)(
        view,
        loadError
          ? multisigSyncNotice(true, "background-unavailable", "multisig-list-retry")
          : emptyState("This multisig is no longer watched."),
      )
    );
  }
  const tracked = proposals.filter((proposal) => proposal.multisigId === record.id);
  const canSign = status.accounts.some(
    (stored) =>
      stored.networkId === record.networkId &&
      record.signers.some((signer) => sameFelt(signer, stored.address)),
  );
  const openCount = tracked.filter((proposal) => proposal.state !== "executed").length;
  return (
    (view === "multisig-home"
      ? ""
      : flowHeader(
          multisigDisplayName(record),
          status,
          `${record.quorum} of ${record.signers.length} signers`,
        )) +
    (view === "multisig-home" ? dockScreen : flowScreen)(
      view,
      `${multisigSyncNotice(loadError, sync, "multisig-list-retry")}
      ${multisigPortfolio({
        canSign,
        data: portfolio,
        openCount,
        preferences,
        proposals: `${multisigProposalList(record, tracked, status.accounts, account, preferences)}
          <p id="multisig-proposal-result" role="status"></p>`,
        record,
      })}
      <p id="multisig-detail-result" role="status"></p>`,
    )
  );
};
