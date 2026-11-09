/**
 * The identifier row every settled-transaction screen ends on.
 *
 * One shape, stated once: the hash truncated so the row leaves space for the
 * control beside it, linked to the explorer when the network has one, and
 * copying in full. Shared rather than repeated because the wallet has several
 * screens that report a submitted transaction — Send, Swap, account and
 * multisig deployment, NFT transfer — and a reader should not have to learn a
 * different receipt on each one.
 *
 * The markup renders empty; {@link applyOutcomeHash} fills it once the hash is
 * known and withdraws the row entirely when there is none, so an outcome that
 * never got an identifier does not show an empty line with a dead control.
 */
import { explorerTransactionUrl } from "@bramble/wallet-model/networks";
import { bindCopyButtons } from "./dom";
import { accountLabel, inlineCopyButton } from "./parts";

/**
 * Renders the row for `id`. The caller owns where it sits; the anchor and the
 * copy control carry no destination until the hash arrives.
 */
export const outcomeHashRow = (id: string): string => `
  <span class="send-outcome-hash" hidden>
    <a id="${id}-link" target="_blank" rel="noopener noreferrer"><code id="${id}"></code></a>
    ${inlineCopyButton("", "Copy transaction hash")}
  </span>`;

/**
 * Fills the row under `root` for `id`. An empty `hash` hides it. The explorer
 * link comes only from the shared gate, so a network without one (devnet) or a
 * malformed hash leaves the hash readable and copyable but unlinked rather than
 * pointing somewhere that cannot resolve.
 *
 * Safe to call on every paint: it rebinds nothing that is already bound, and
 * the copy binding reads its value at click time.
 */
export const applyOutcomeHash = (
  root: ParentNode,
  id: string,
  hash: string,
  networkId: string,
): void => {
  const code = root.querySelector(`#${id}`);
  if (!code) {
    return;
  }
  const row = code.closest(".send-outcome-hash");
  row?.toggleAttribute("hidden", hash.length === 0);
  if (hash.length === 0) {
    return;
  }
  code.textContent = accountLabel(hash);
  code.setAttribute("title", hash);
  const link = row?.querySelector<HTMLAnchorElement>("a");
  const explorer = explorerTransactionUrl(networkId, hash);
  if (link && explorer) {
    link.href = explorer;
  } else {
    link?.removeAttribute("href");
  }
  row?.querySelector<HTMLElement>("[data-copy]")?.setAttribute("data-copy", hash);
  // The shell binds the app once at mount, before this row carries a hash. The
  // binding is idempotent and reads `data-copy` at click time, so claiming the
  // control here makes the row work wherever its screen is mounted.
  bindCopyButtons(row);
};
