/**
 * Independent-review sheet bindings. Pasted packages are parsed locally with
 * strict stored-schema validators and never leave the extension.
 */
import { escapeHtml } from "../shared/html";
import { renderFragment, showToast } from "./dom";
import { parseMultisigReviewPackage } from "./multisig-model";
import { closeMultisigSheet, openMultisigSheet } from "./multisig-sheet-motion";
import { accountLabel } from "./parts";

/**
 * Binds proposal review-sheet open/close controls and the local package
 * decoder. Invalid pasted data is rejected without rendering any field.
 */
export const bindMultisigReviewTools = (root: Element | null): void => {
  const panelFor = (proposalId: string): HTMLElement | undefined =>
    [...(root?.querySelectorAll<HTMLElement>("[data-ms-review-panel]") ?? [])].find(
      (panel) => panel.dataset["msReviewPanel"] === proposalId,
    );
  const triggerFor = (proposalId: string): HTMLButtonElement | undefined =>
    [...(root?.querySelectorAll<HTMLButtonElement>("[data-ms-review-open]") ?? [])].find(
      (button) => button.dataset["msReviewOpen"] === proposalId,
    );
  root?.querySelectorAll<HTMLButtonElement>("[data-ms-review-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = panelFor(button.dataset["msReviewOpen"] ?? "");
      if (panel) {
        openMultisigSheet(panel, panel.querySelector<HTMLButtonElement>("[data-ms-review-close]"));
      }
    });
  });
  root?.querySelectorAll<HTMLButtonElement>("[data-ms-review-close]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = panelFor(button.dataset["msReviewClose"] ?? "");
      const trigger = triggerFor(button.dataset["msReviewClose"] ?? "");
      if (panel) closeMultisigSheet(panel, trigger);
    });
  });
  root?.querySelectorAll<HTMLElement>("[data-ms-review-panel]").forEach((panel) => {
    panel.addEventListener("click", (event) => {
      if (event.target !== panel) return;
      closeMultisigSheet(panel, triggerFor(panel.dataset["msReviewPanel"] ?? ""));
    });
    panel.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== "Escape") return;
      closeMultisigSheet(panel, triggerFor(panel.dataset["msReviewPanel"] ?? ""));
    });
  });
  root?.querySelectorAll<HTMLButtonElement>("[data-ms-review-decode]").forEach((button) => {
    button.addEventListener("click", () => {
      const panel = panelFor(button.dataset["msReviewDecode"] ?? "");
      const input = panel?.querySelector<HTMLTextAreaElement>('textarea[name="reviewPackage"]');
      const output = panel?.querySelector<HTMLElement>("[data-ms-review-output]");
      if (!output) return;
      const parsed = parseMultisigReviewPackage(input?.value ?? "");
      if (!parsed) {
        output.textContent = "Invalid review package format.";
        showToast("Review package could not be verified", "error");
        return;
      }
      const call = parsed.proposal.call;
      renderFragment(
        output,
        `<dl class="request-detail">
          <div><dt>Network</dt><dd>${escapeHtml(parsed.multisig.networkId)}</dd></div>
          <div><dt>Multisig</dt><dd><code>${escapeHtml(accountLabel(parsed.multisig.address))}</code></dd></div>
          <div><dt>Proposal</dt><dd><code>${escapeHtml(accountLabel(parsed.proposal.txId))}</code></dd></div>
          ${
            call
              ? `<div><dt>Target</dt><dd><code>${escapeHtml(accountLabel(call.contractAddress))}</code></dd></div>
                 <div><dt>Method</dt><dd><code>${escapeHtml(call.entrypoint)}</code></dd></div>
                 <div><dt>Calldata</dt><dd>${call.calldata.length} felt${call.calldata.length === 1 ? "" : "s"}</dd></div>
                 <div><dt>Salt</dt><dd><code>${escapeHtml(call.salt)}</code></dd></div>`
              : "<div><dt>Call data</dt><dd>Not included — do not confirm from this package alone.</dd></div>"
          }
        </dl><p class="hint">Compare the proposal id with the wallet or an on-chain source before approving.</p>`,
      );
    });
  });
};
