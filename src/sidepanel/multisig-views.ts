/**
 * Pure multisig screen templates: the watched-multisig list with add and
 * deploy entries, a multisig detail screen with signers and tracked
 * proposals, the propose form, and the deploy form. Logic-free string
 * builders; all bindings live in multisig-ui.ts.
 */
import type { WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { sameFelt } from "../starknet/networks";
import type {
  MultisigProposalCall,
  MultisigProposalRecord,
  MultisigRecord,
} from "../storage/multisig-store";
import type { AccountRef } from "../storage/vault-schema";
import { icon } from "./icons";
import { accountLabel, copyButton, flowHeader, flowScreen, noAccountEmpty } from "./parts";

const multisigDisplayName = (record: MultisigRecord): string =>
  record.name ?? accountLabel(record.address);

const stateLabel: Readonly<Record<MultisigProposalRecord["state"], string>> = {
  confirmed: "Ready to execute",
  executed: "Executed",
  "not-found": "Not found",
  pending: "Collecting confirmations",
};

const formatCalldata = (calldata: readonly string[]): string =>
  calldata.length === 0 ? "(empty)" : calldata.map((felt) => accountLabel(felt)).join(" ");

const proposalCallDetails = (call: MultisigProposalCall): string => `
  <div class="review-panel" role="note">
    <p><strong>On-chain effect when executed</strong></p>
    <p>Contract: <code>${escapeHtml(accountLabel(call.contractAddress))}</code></p>
    <p>Entrypoint: <code>${escapeHtml(call.entrypoint)}</code></p>
    <p>Calldata: <code>${escapeHtml(formatCalldata(call.calldata))}</code></p>
    <p>Salt: <code>${escapeHtml(accountLabel(call.salt))}</code></p>
  </div>`;

const untrackedProposalWarning = (): string => `
  <div class="review-panel" role="note">
    <p class="review-flag">Notes and summaries are not verified on-chain. Confirm only after verifying this proposal id on a block explorer or with the proposer.</p>
    <label class="hint">
      <input type="checkbox" data-ms-ack />
      I verified what this proposal does
    </label>
  </div>`;

const multisigRow = (record: MultisigRecord, pendingCount: number): string => `
  <li class="allowance-row">
    <button class="menu-row" data-multisig-open="${escapeHtml(record.id)}" type="button">
      <span class="menu-icon">${icon("wallet")}</span>
      <span class="menu-copy">
        <strong>${escapeHtml(multisigDisplayName(record))}</strong>
        <span class="hint">${record.quorum} of ${record.signers.length} signers${pendingCount > 0 ? ` · ${pendingCount} open` : ""}</span>
      </span>
      <span class="menu-chevron">${icon("chevronRight")}</span>
    </button>
  </li>`;

/**
 * Renders the Multisigs flow: watched contracts, the watch-by-address form,
 * and the entry into the deploy flow.
 */
export const multisigsFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  multisigs: readonly MultisigRecord[],
  proposals: readonly MultisigProposalRecord[],
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
      `<section class="section">
        <div class="row"><h2>Watched multisigs</h2>
          <button class="secondary small" data-view="multisig-deploy" type="button" ${account ? "" : "disabled"}>${icon("plus")}Deploy new</button>
        </div>
        ${
          account === null
            ? noAccountEmpty(status)
            : scoped.length === 0
              ? '<p class="empty">No multisigs watched yet. Watch one below or deploy a new one.</p>'
              : `<ul class="allowance-list">${scoped.map((record) => multisigRow(record, openCount(record))).join("")}</ul>`
        }
        <p id="multisig-list-result" role="status"></p>
      </section>
      <section class="section">
        <h2>Watch a multisig</h2>
        <form id="multisig-add-form">
          <label><span>Contract address</span><input class="mono" name="address" placeholder="0x…" required autocomplete="off" spellcheck="false" ${account ? "" : "disabled"} /></label>
          <label><span>Name (optional)</span><input name="name" maxlength="48" autocomplete="off" ${account ? "" : "disabled"} /></label>
          <span class="hint">The active account must be one of the multisig's signers.</span>
          <button class="secondary" type="submit" ${account ? "" : "disabled"}>${icon("check")}Watch multisig</button>
          <p id="multisig-add-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};

const proposalActions = (proposal: MultisigProposalRecord): string => {
  if (proposal.state === "executed" || proposal.state === "not-found") {
    return "";
  }
  const execute =
    proposal.state === "confirmed"
      ? proposal.call
        ? `<button class="secondary small" data-ms-execute="${escapeHtml(proposal.id)}" type="button">${icon("send")}Execute</button>`
        : '<span class="hint">Execute from the wallet that proposed it (call details are not shared with a pasted id).</span>'
      : "";
  const confirmDisabled = proposal.call === null ? " disabled" : "";
  const confirmAttr =
    proposal.call === null ? ` data-ms-requires-ack="true"${confirmDisabled}` : "";
  const revokeDisabled = proposal.call === null ? " disabled" : "";
  const revokeAttr = proposal.call === null ? ` data-ms-requires-ack="true"${revokeDisabled}` : "";
  return `<div class="row">
    <button class="secondary small" data-ms-confirm="${escapeHtml(proposal.id)}" type="button"${confirmAttr}>${icon("check")}Confirm</button>
    <button class="secondary small" data-ms-revoke="${escapeHtml(proposal.id)}" type="button"${revokeAttr}>${icon("x")}Revoke</button>
    ${execute}
  </div>`;
};

const proposalRow = (proposal: MultisigProposalRecord, quorum: number): string => `
  <li class="allowance-row">
    <div class="allowance-copy">
      <strong>${escapeHtml(proposal.summary)}</strong>
      <span class="hint">${escapeHtml(stateLabel[proposal.state])} · ${proposal.confirmations} of ${quorum} confirmations</span>
      <code>${escapeHtml(accountLabel(proposal.txId))}</code>
      ${proposal.call ? proposalCallDetails(proposal.call) : untrackedProposalWarning()}
    </div>
    ${copyButton(proposal.txId, "Copy proposal id")}
    ${proposalActions(proposal)}
  </li>`;

const signerRow = (signer: string, account: AccountRef | null): string => `
  <li class="address-line">
    <code>${escapeHtml(accountLabel(signer))}</code>
    ${account && sameFelt(signer, account.address) ? '<span class="pill">You</span>' : ""}
    ${copyButton(signer, "Copy signer address")}
  </li>`;

/**
 * Renders one multisig's detail screen: on-chain config, tracked proposals
 * with lifecycle actions, and the track-by-id form.
 */
export const multisigDetailFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  record: MultisigRecord | null,
  proposals: readonly MultisigProposalRecord[],
): string => {
  if (!record) {
    return (
      flowHeader("Multisig", status) +
      flowScreen("multisig-detail", '<p class="empty">This multisig is no longer watched.</p>')
    );
  }
  const tracked = proposals.filter((proposal) => proposal.multisigId === record.id);
  return (
    flowHeader(
      multisigDisplayName(record),
      status,
      `${record.quorum} of ${record.signers.length} signers`,
    ) +
    flowScreen(
      "multisig-detail",
      `<section class="section">
        <div class="row"><h2>Contract</h2>
          <div class="header-actions">
            <button id="multisig-refresh" class="icon-button" data-multisig-id="${escapeHtml(record.id)}" type="button" aria-label="Refresh from chain" title="Refresh from chain">${icon("refresh")}</button>
            <button class="icon-button danger" data-multisig-remove="${escapeHtml(record.id)}" type="button" aria-label="Stop watching" title="Stop watching">${icon("x")}</button>
          </div>
        </div>
        <p class="address-line"><code>${escapeHtml(record.address)}</code>${copyButton(record.address, "Copy multisig address")}</p>
        <h2>Signers</h2>
        <ul class="address-book">${record.signers.map((signer) => signerRow(signer, account)).join("")}</ul>
        <span class="hint">Signer and quorum changes are proposals the multisig sends to itself (add_signers, remove_signers, change_quorum).</span>
        <p id="multisig-detail-result" role="status"></p>
      </section>
      <section class="section">
        <div class="row"><h2>Proposals</h2>
          <button class="secondary small" data-view="multisig-propose" type="button">${icon("plus")}New proposal</button>
        </div>
        ${
          tracked.length === 0
            ? '<p class="empty">No proposals tracked yet. Propose one, or paste an id shared by another signer.</p>'
            : `<ul class="allowance-list">${tracked.map((proposal) => proposalRow(proposal, record.quorum)).join("")}</ul>`
        }
        <p id="multisig-proposal-result" role="status"></p>
      </section>
      <section class="section">
        <h2>Track a shared proposal</h2>
        <form id="multisig-track-form">
          <label><span>Proposal id</span><input class="mono" name="txId" placeholder="0x…" required autocomplete="off" spellcheck="false" /></label>
          <label><span>Note (optional)</span><input name="summary" maxlength="120" autocomplete="off" /></label>
          <span class="hint">Notes are not verified on-chain. Tracked proposals can be confirmed and revoked after you verify the proposal id; executing needs the original call from the proposer's wallet.</span>
          <button class="secondary" type="submit">${icon("check")}Track proposal</button>
          <p id="multisig-track-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};

/**
 * Renders the single-call proposal form for a watched multisig.
 */
export const multisigProposeFlow = (
  status: WalletStatus,
  record: MultisigRecord | null,
): string => {
  if (!record) {
    return (
      flowHeader("New proposal", status) +
      flowScreen("multisig-propose", '<p class="empty">This multisig is no longer watched.</p>')
    );
  }
  return (
    flowHeader("New proposal", status, multisigDisplayName(record)) +
    flowScreen(
      "multisig-propose",
      `<section class="section">
        <form id="multisig-propose-form">
          <label><span>Contract to call</span><input class="mono" name="to" placeholder="0x…" required autocomplete="off" spellcheck="false" /></label>
          <label><span>Entrypoint</span><input class="mono" name="entrypoint" placeholder="transfer" required autocomplete="off" spellcheck="false" /></label>
          <label><span>Calldata felts (space or newline separated)</span><textarea class="mono" name="calldata" rows="3" autocomplete="off" spellcheck="false"></textarea></label>
          <label><span>Salt</span><input class="mono" name="salt" value="0x0" autocomplete="off" spellcheck="false" /></label>
          <label><span>Note (optional)</span><input name="summary" maxlength="120" autocomplete="off" /></label>
          <span class="hint">Submitting does not confirm: confirm your own proposal from the detail screen, then share the proposal id with the other signers. Re-proposing identical calls needs a different salt.</span>
          <button class="secondary" type="submit">${icon("send")}Submit proposal</button>
          <p id="multisig-propose-result" role="status"></p>
        </form>
      </section>`,
    )
  );
};

/**
 * Renders the deploy form for a new multisig from the pinned class, including
 * the declare-first path when the class is missing on the active network.
 */
export const multisigDeployFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  declared: boolean | "error" | null,
): string =>
  flowHeader("Deploy multisig", status) +
  flowScreen(
    "multisig-deploy",
    `<section class="section">
      ${
        declared === false
          ? `<div class="row"><span class="pill">Class not declared</span></div>
             <p class="hint">The multisig class is not declared on ${escapeHtml(status.network)} yet. Declaring is a one-time, fee-paying transaction from your account; afterwards anyone can deploy from the same class.</p>
             <button id="multisig-declare" class="secondary" type="button">${icon("send")}Declare multisig class</button>
             <p id="multisig-declare-result" role="status"></p>`
          : declared === "error"
            ? `<div class="row"><span class="pill">Status unavailable</span></div>
               <p class="hint">Could not check whether the multisig class is declared on ${escapeHtml(status.network)} — the network may be unreachable.</p>
               <button id="multisig-class-retry" class="secondary" type="button">${icon("refresh")}Retry</button>`
            : declared === null
              ? '<p class="hint">Checking whether the multisig class is declared on this network…</p>'
              : ""
      }
      <form id="multisig-deploy-form">
        <label><span>Signer addresses (one per line)</span><textarea class="mono" name="signers" rows="4" required autocomplete="off" spellcheck="false">${account ? escapeHtml(account.address) : ""}</textarea></label>
        <label><span>Quorum (confirmations required)</span><input name="quorum" inputmode="numeric" value="1" required autocomplete="off" /></label>
        <label><span>Salt</span><input class="mono" name="salt" value="0x0" autocomplete="off" spellcheck="false" /></label>
        <span class="hint">The contract address is derived from the class, signers, quorum, and salt — the same inputs always produce the same address on every network. Name it after it finalizes, when you add it to your watched multisigs.</span>
        <button class="secondary" type="submit" ${account && declared === true ? "" : "disabled"}>${icon("send")}Deploy multisig</button>
        <p id="multisig-deploy-result" role="status"></p>
      </form>
    </section>`,
  );
