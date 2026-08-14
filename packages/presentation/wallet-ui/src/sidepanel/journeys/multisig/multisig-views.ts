/** Pure screens for stable Argent multisig accounts and frozen intents. */
import { escapeHtml } from "@mc-wallet/core/html";
import {
  type ArgentMultisigConfigReview,
  type ArgentMultisigPublicConfig,
  reviewArgentMultisigConfigChange,
} from "@mc-wallet/multisig/chain";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@mc-wallet/multisig/repository";
import type { WalletPreferences } from "@mc-wallet/settings/preferences";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import { preparedArgentMultisigFee } from "@mc-wallet/starknet/multisig-invoke";
import { verificationContext, verifyCalls } from "@mc-wallet/transactions/verify";
import { emptyState, pill, receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { selectField, textareaField } from "@mc-wallet/ui-kit/fields";
import { menuRow } from "@mc-wallet/ui-kit/navigation";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import {
  accountDisplayName,
  dockScreen,
  flowHeader,
  flowScreen,
  noAccountEmpty,
  walletMenuRow,
} from "../../shared/parts";
import {
  formatFeeEstimate,
  reviewCallsList,
  reviewPanel,
  riskFlagMessages,
} from "../../shared/review-render";
import { multisigDisplayName } from "./multisig-model";
import {
  EMPTY_MULTISIG_PORTFOLIO,
  type MultisigPortfolioData,
  multisigPortfolio,
} from "./multisig-portfolio";

export { multisigDeployFlow } from "./multisig-deploy-view";
export { multisigDisplayName } from "./multisig-model";
export { multisigProposeFlow } from "./multisig-propose-view";

const configLabel = (view: ArgentMultisigView): string =>
  view.config
    ? `${view.config.threshold} of ${view.config.signerGuids.length} signers`
    : "Configuration unavailable";

const multisigRow = (view: ArgentMultisigView, openCount: number): string => `
  <li class="allowance-row">
    ${menuRow({
      attributes: { "data-multisig-open": view.record.id },
      icon: "wallet",
      label: multisigDisplayName(view.record),
      supportingText: `${configLabel(view)}${openCount > 0 ? ` · ${openCount} open` : ""}`,
    })}
  </li>`;

/**
 * Renders watched Argent multisigs for the active network.
 */
export const multisigsFlow = (
  status: WalletStatus,
  account: AccountRef | null,
  multisigs: readonly ArgentMultisigView[],
  intents: readonly ArgentMultisigSigningIntent[],
  loadError = false,
): string => {
  const scoped = multisigs.filter((view) => view.record.networkId === status.networkId);
  const openCount = (record: ArgentMultisigRecord): number =>
    intents.filter(
      (intent) =>
        intent.accountId === record.id &&
        (intent.state === "collecting" || intent.state === "ready"),
    ).length;
  return (
    flowHeader("Argent multisigs", status, `${scoped.length} watched`) +
    flowScreen(
      "multisigs",
      `${
        loadError
          ? '<div class="review-panel" role="alert"><p class="review-flag">The background could not refresh the Argent multisig registry. Retry before signing.</p></div>'
          : ""
      }
      <section class="section">
        <div class="menu-list" role="group" aria-label="Argent multisig actions">
          ${walletMenuRow("multisig-watch", "Add existing multisig", "plus")}
          ${walletMenuRow("multisig-deploy", "Deploy new multisig", "users")}
        </div>
      </section>
      <section class="section">
        <p class="eyebrow">Watched accounts</p>
        ${
          account === null
            ? noAccountEmpty(status)
            : scoped.length === 0
              ? emptyState("No Argent multisigs are watched on this network yet.")
              : `<ul class="allowance-list">${scoped.map((view) => multisigRow(view, openCount(view.record))).join("")}</ul>`
        }
        ${loadError ? button({ attributes: { id: "multisig-list-retry" }, label: "Retry" }) : ""}
      </section>`,
    )
  );
};

const localSignerOptions = (
  view: ArgentMultisigView,
  accounts: readonly AccountRef[],
  preferences: WalletPreferences | null,
): readonly { readonly label: string; readonly value: string }[] =>
  view.config
    ? accounts
        .filter(
          (account) =>
            account.networkId === view.record.networkId &&
            view.config?.signerGuids.includes(argentSignerGuid(account.publicKeyX)),
        )
        .map((account) => ({
          label: accountDisplayName(account, preferences),
          value: account.id,
        }))
    : [];

const exactCalls = (intent: ArgentMultisigSigningIntent): string =>
  intent.prepared.calls
    .map(
      (call, index) => `<li class="review-panel">
        <p><strong>Call ${index + 1}</strong> · <code>${escapeHtml(call.entrypoint)}</code></p>
        <p>Contract · <code>${escapeHtml(call.contractAddress)}</code></p>
        <p>Calldata · <code>${escapeHtml(call.calldata.join(" ") || "none")}</code></p>
      </li>`,
    )
    .join("");

const configReviewFor = (
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

const configReviewView = (
  review: ArgentMultisigConfigReview,
  current: ArgentMultisigPublicConfig,
): string => {
  const change = review.change;
  const changedSigners =
    change.kind === "replace_signer"
      ? [`Remove ${change.removeSignerPublicKey}`, `Add ${change.addSignerPublicKey}`]
      : change.kind === "change_threshold"
        ? []
        : change.signerPublicKeys.map(
            (key) => `${change.kind === "add_signers" ? "Add" : "Remove"} ${key}`,
          );
  return `<section class="review-panel" aria-label="Signer authority change">
    <p class="review-flag"><strong>${escapeHtml(review.summary)}</strong></p>
    <p>Threshold · <strong>${current.threshold} of ${current.signerPublicKeys.length} before → ${review.nextConfig.threshold} of ${review.nextConfig.signerPublicKeys.length} after</strong></p>
    <p>Current signers</p>
    <ol>${current.signerPublicKeys.map((key) => `<li><code>${escapeHtml(key)}</code></li>`).join("")}</ol>
    <p>Exact change</p>
    ${changedSigners.map((line) => `<p><code>${escapeHtml(line)}</code></p>`).join("")}
    <p>Resulting threshold · <strong>${review.nextConfig.threshold} of ${review.nextConfig.signerPublicKeys.length}</strong></p>
    <p>Resulting signers</p>
    <ol>${review.nextConfig.signerPublicKeys.map((key) => `<li><code>${escapeHtml(key)}</code></li>`).join("")}</ol>
  </section>`;
};

const configMatchesIntent = (
  intent: ArgentMultisigSigningIntent,
  view: ArgentMultisigView,
): boolean => {
  const current = view.config;
  return (
    current !== null &&
    sameFelt(current.classHash, intent.configSnapshot.classHash) &&
    current.threshold === intent.configSnapshot.threshold &&
    current.signerGuids.length === intent.configSnapshot.signerGuids.length &&
    current.signerGuids.every((guid, index) =>
      sameFelt(guid, intent.configSnapshot.signerGuids[index] ?? ""),
    )
  );
};

const intentCard = (
  intent: ArgentMultisigSigningIntent,
  view: ArgentMultisigView,
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string => {
  const options = localSignerOptions(view, status.accounts, preferences);
  const hasFreshAuthority = configMatchesIntent(intent, view);
  const canCollect =
    hasFreshAuthority && (intent.state === "collecting" || intent.state === "ready");
  const fee = preparedArgentMultisigFee(intent.prepared);
  const configReview = configReviewFor(intent, view);
  const transactionReview = verifyCalls(
    intent.prepared.calls.map((call) => ({ ...call, calldata: [...call.calldata] })),
    {
      ...verificationContext(view.record, preferences ?? { addressBook: [], tokens: [] }),
      ...(configReview ? { knownContracts: [view.record.address] } : {}),
    },
  );
  return `<article class="allowance-row" data-ms-intent="${escapeHtml(intent.id)}">
    <div class="row"><strong>Exact Starknet transaction</strong>${pill(intent.state)}</div>
    <p class="hint"><strong>Locally decoded summary:</strong> ${escapeHtml(intent.summary)}</p>
    <section aria-label="Decoded exact calls">
      <p><strong>Decoded exact calls</strong></p>
      ${reviewCallsList(transactionReview.calls.map((call) => call.summary))}
    </section>
    ${reviewPanel(riskFlagMessages(transactionReview.flags))}
    ${receipt(
      [
        {
          label: "Transaction hash",
          action: {
            attributes: { "data-copy": intent.prepared.transactionHash },
            icon: "copy",
            label: "Copy transaction hash",
          },
          value: intent.prepared.transactionHash,
          valueStyle: "code",
        },
        { label: "Sender", value: intent.prepared.senderAddress, valueStyle: "code" },
        { label: "Chain ID", value: intent.prepared.chainId, valueStyle: "code" },
        { label: "Nonce", value: intent.prepared.nonce, valueStyle: "code" },
        { label: "Maximum network fee", value: formatFeeEstimate(fee) },
        {
          label: "Signatures",
          value: `${intent.signatures.length} of ${intent.configSnapshot.threshold}`,
        },
        { label: "Calls", value: String(intent.prepared.calls.length) },
      ],
      { "data-ms-exact-identity": "true" },
    )}
    ${
      hasFreshAuthority
        ? ""
        : '<div class="review-panel" role="alert"><p class="review-flag">The fresh on-chain signer authority does not exactly match this intent snapshot. Signing and submission are disabled.</p></div>'
    }
    ${configReview && view.record.currentConfig ? configReviewView(configReview, view.record.currentConfig) : ""}
    <details><summary>Review exact calls</summary><ol class="allowance-list">${exactCalls(intent)}</ol></details>
    <p class="hint">Verify the locally decoded details against the exact calls, sender, nonce, fee ceiling, and transaction hash.</p>
    ${
      options.length > 0 && canCollect
        ? selectField({
            label: "Signer in this wallet",
            name: "signerAccountId",
            options,
          })
        : ""
    }
    <div class="row">
      ${button({
        attributes: { "data-ms-copy-package": intent.id },
        label: "Copy intent package",
        size: "small",
        variant: "secondary",
      })}
      ${
        options.length > 0 && canCollect
          ? button({
              attributes: { "data-ms-sign": intent.id },
              label: "Sign exact hash",
              size: "small",
            })
          : ""
      }
      ${
        intent.state === "ready" && hasFreshAuthority
          ? button({
              attributes: { "data-ms-submit": intent.id },
              label: "Submit",
              size: "small",
            })
          : ""
      }
    </div>
    ${
      intent.signatures.length > 0
        ? `<div class="row">${intent.signatures
            .map((_, index) =>
              button({
                attributes: {
                  "data-ms-copy-signature": intent.id,
                  "data-ms-signature-index": String(index),
                },
                label: `Copy signature ${index + 1}`,
                size: "small",
                variant: "ghost",
              }),
            )
            .join("")}</div>`
        : ""
    }
    ${
      canCollect
        ? `<details><summary>Import signature fragment</summary>
          <form data-ms-signature-form="${escapeHtml(intent.id)}">
            ${textareaField({ label: "Signature fragment", name: "signature", placeholder: '{"publicKey":"0x…","r":"0x…","s":"0x…"}', required: true, rows: 3, spellcheck: false })}
            ${button({ label: "Verify and import", size: "small", type: "submit", variant: "secondary" })}
          </form>
        </details>`
        : ""
    }
  </article>`;
};

const intentList = (
  record: ArgentMultisigRecord,
  view: ArgentMultisigView,
  intents: readonly ArgentMultisigSigningIntent[],
  status: WalletStatus,
  preferences: WalletPreferences | null,
): string => {
  const scoped = intents.filter((intent) => intent.accountId === record.id);
  return scoped.length === 0
    ? emptyState("No frozen signing intents are stored for this account.")
    : `<div class="allowance-list">${scoped
        .map((intent) => intentCard(intent, view, status, preferences))
        .join("")}</div><p id="multisig-intent-result" role="status"></p>`;
};

/**
 * Renders one shared account, its portfolio, and exact frozen intents.
 */
export const multisigDetailFlow = (
  status: WalletStatus,
  _account: AccountRef | null,
  view: ArgentMultisigView | null,
  intents: readonly ArgentMultisigSigningIntent[],
  loadError = false,
  preferences: WalletPreferences | null = null,
  screen: "multisig-detail" | "multisig-home" = "multisig-detail",
  portfolio: MultisigPortfolioData = EMPTY_MULTISIG_PORTFOLIO,
): string => {
  if (!view) {
    return (
      (screen === "multisig-home" ? "" : flowHeader("Argent multisig", status)) +
      (screen === "multisig-home" ? dockScreen : flowScreen)(
        screen,
        emptyState("This Argent multisig is no longer watched."),
      )
    );
  }
  const { record } = view;
  const options = localSignerOptions(view, status.accounts, preferences);
  const openCount = intents.filter(
    (intent) =>
      intent.accountId === record.id && (intent.state === "collecting" || intent.state === "ready"),
  ).length;
  return (
    (screen === "multisig-home"
      ? ""
      : flowHeader(multisigDisplayName(record), status, configLabel(view))) +
    (screen === "multisig-home" ? dockScreen : flowScreen)(
      screen,
      `${
        loadError || view.config === null
          ? '<div class="review-panel" role="alert"><p class="review-flag">Current on-chain signer authority is unavailable. Signing is disabled.</p></div>'
          : ""
      }
      ${multisigPortfolio({
        canSign: options.length > 0 && view.config !== null,
        data: portfolio,
        intents: intentList(record, view, intents, status, preferences),
        openCount,
        preferences,
        record,
      })}
      <p id="multisig-detail-result" role="status"></p>`,
    )
  );
};

/**
 * Stable contract identity shown beside configuration and review surfaces.
 */
export const argentMultisigContractLabel = (): string =>
  `Argent Multisig ${ARGENT_MULTISIG_CONTRACT.version}`;
