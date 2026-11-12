/**
 * Technical-detail views for a frozen Argent multisig intent: the exact calls
 * it carries and, for a single signer-management call, the decoded authority
 * change against the record's current configuration. Every address and signer
 * key shows truncated with its full value on hover and a copy control, so a
 * co-signer can check the identity they were told against the one being
 * signed. Pure templates over already-validated repository data.
 */
import { escapeHtml } from "@bramble/core/html";
import {
  type ArgentMultisigConfigReview,
  type ArgentMultisigPublicConfig,
  reviewArgentMultisigConfigChange,
} from "@bramble/multisig/chain";
import type { ArgentMultisigSigningIntent } from "@bramble/multisig/repository";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { t, th } from "../../../i18n/messages";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import { accountLabel, inlineCopyButton } from "../../shared/parts";

const signerKeyItem = (key: string): string =>
  `<li><code title="${escapeHtml(key)}">${escapeHtml(accountLabel(key))}</code>${inlineCopyButton(key, t("review.multisig.change.copyKey"))}</li>`;

/**
 * Renders each prepared call with its entrypoint, target contract (copyable in
 * full), and raw calldata.
 */
export const exactCalls = (intent: ArgentMultisigSigningIntent): string =>
  intent.prepared.calls
    .map(
      (call, index) => `<li class="review-panel">
        <p><strong>${th("review.multisig.exact.call", { index: String(index + 1) })}</strong> · <code>${escapeHtml(call.entrypoint)}</code></p>
        <p>${th("review.multisig.exact.contract")} <code title="${escapeHtml(call.contractAddress)}">${escapeHtml(accountLabel(call.contractAddress))}</code>${inlineCopyButton(call.contractAddress, t("review.multisig.exact.copyContract", { index: String(index + 1) }))}</p>
        <p>${th("review.multisig.exact.calldata")} <code>${escapeHtml(call.calldata.join(" ") || t("review.multisig.exact.none"))}</code></p>
      </li>`,
    )
    .join("");

/**
 * Decodes the intent as a signer-authority change when it is exactly one
 * supported management call frozen against the record's current configuration;
 * null for anything else, including a decode failure.
 */
export const configReviewFor = (
  intent: ArgentMultisigSigningIntent,
  view: ArgentMultisigView,
): ArgentMultisigConfigReview | null => {
  const current = view.record.currentConfig;
  const call = intent.prepared.calls[0];
  if (
    !current ||
    intent.prepared.calls.length !== 1 ||
    !call ||
    current.threshold !== intent.configSnapshot.threshold ||
    current.signerPublicKeys.length !== intent.configSnapshot.signerGuids.length ||
    current.signerPublicKeys
      .map(argentSignerGuid)
      .some((guid, index) => guid !== intent.configSnapshot.signerGuids[index])
  ) {
    return null;
  }
  try {
    return reviewArgentMultisigConfigChange(view.record.address, current, call);
  } catch {
    return null;
  }
};

// One "Add <key>" / "Remove <key>" line of the exact change, kept whole when
// it is short enough to read and truncated otherwise; the key copies whole.
const changedSignerLine = (verb: "Add" | "Remove", key: string): string => {
  const line = t(verb === "Add" ? "review.multisig.change.add" : "review.multisig.change.remove", {
    key,
  });
  const copyLabel = t(
    verb === "Add" ? "review.multisig.change.copyAdd" : "review.multisig.change.copyRemove",
  );
  return `<p><code title="${escapeHtml(line)}">${escapeHtml(line.length > 24 ? `${line.slice(0, 14)}…${line.slice(-6)}` : line)}</code>${inlineCopyButton(key, copyLabel)}</p>`;
};

// "Label · figures": everything after the first " · " is the figure, set in
// bold as before; a line without the separator is bold whole.
const strongAfterLabel = (line: string): string => {
  const at = line.indexOf(" · ");
  return at < 0
    ? `<strong>${escapeHtml(line)}</strong>`
    : `${escapeHtml(line.slice(0, at + 3))}<strong>${escapeHtml(line.slice(at + 3))}</strong>`;
};

/**
 * Renders the decoded authority change: threshold before and after, the
 * current signer set, the exact additions and removals, and the resulting set.
 */
export const configReviewView = (
  review: ArgentMultisigConfigReview,
  current: ArgentMultisigPublicConfig,
): string => {
  const change = review.change;
  const changedSigners =
    change.kind === "replace_signer"
      ? [
          changedSignerLine("Remove", change.removeSignerPublicKey),
          changedSignerLine("Add", change.addSignerPublicKey),
        ]
      : change.kind === "change_threshold"
        ? []
        : change.signerPublicKeys.map((key) =>
            changedSignerLine(change.kind === "add_signers" ? "Add" : "Remove", key),
          );
  return `<section class="review-panel" aria-label="${th("review.multisig.change.label")}">
    <p class="review-flag"><strong>${escapeHtml(review.summary)}</strong></p>
    <p>${strongAfterLabel(
      t("review.multisig.change.threshold", {
        after: String(review.nextConfig.threshold),
        afterTotal: String(review.nextConfig.signerPublicKeys.length),
        before: String(current.threshold),
        beforeTotal: String(current.signerPublicKeys.length),
      }),
    )}</p>
    <p>${th("review.multisig.change.current")}</p>
    <ol>${current.signerPublicKeys.map(signerKeyItem).join("")}</ol>
    <p>${th("review.multisig.change.exact")}</p>
    ${changedSigners.join("")}
    <p>${strongAfterLabel(
      t("review.multisig.change.resultingThreshold", {
        threshold: String(review.nextConfig.threshold),
        total: String(review.nextConfig.signerPublicKeys.length),
      }),
    )}</p>
    <p>${th("review.multisig.change.resultingSigners")}</p>
    <ol>${review.nextConfig.signerPublicKeys.map(signerKeyItem).join("")}</ol>
  </section>`;
};
