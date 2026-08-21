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
import { argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import { preparedArgentMultisigFee } from "@mc-wallet/starknet/multisig-invoke";
import { verificationContext, verifyCalls } from "@mc-wallet/transactions/verify";
import { emptyState, receipt } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { menuRow } from "@mc-wallet/ui-kit/navigation";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { ArgentMultisigView } from "../../../popup/responses/multisig-responses";
import type { WalletStatus } from "../../../popup/responses/responses";
import { icon } from "../../shared/icons";
import {
  accountDisplayName,
  accountLabel,
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
import { multisigIntentActions, multisigIntentOutcome } from "./multisig-intent-actions";
import { compactIntentListView, intentDeleteButton } from "./multisig-intent-list";
import {
  actionableArgentMultisigIntents,
  feeReplacementIntentFor,
  isFeeReplacementIntent,
  multisigDisplayName,
} from "./multisig-model";
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
    ? `${view.config.threshold} of ${view.config.signerGuids.length} signers${view.authorityStatus === "unsupported-signers" ? " · Watch only" : ""}`
    : {
        available: "Configuration unavailable",
        "invalid-config": "Invalid configuration",
        "network-unavailable": "Authority unavailable",
        undeployed: "Not deployed",
        "unsupported-class": "Unsupported account class",
        "unsupported-signers": "Unsupported signer types",
      }[view.authorityStatus];

const authorityMessage = (view: ArgentMultisigView): string | null =>
  ({
    available: null,
    "invalid-config": "The account returned an invalid signer configuration. Signing is disabled.",
    "network-unavailable": "Signer authority could not be refreshed. Check the network and retry.",
    undeployed: null,
    "unsupported-class":
      "This address is not the pinned Argent Multisig 0.2 account. It is available to inspect only.",
    "unsupported-signers": `This account includes ${view.unsupportedSigners.length === 1 ? "a signer type" : "signer types"} this wallet cannot sign with. It remains available to watch and receive.`,
  })[view.authorityStatus];

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
    actionableArgentMultisigIntents(intents.filter((intent) => intent.accountId === record.id))
      .length;
  return (
    flowHeader(
      "Shared accounts",
      status,
      `${scoped.length} account${scoped.length === 1 ? "" : "s"}`,
    ) +
    flowScreen(
      "multisigs",
      `${
        loadError
          ? '<div class="review-panel" role="alert"><p class="review-flag">The background could not refresh the Argent multisig registry. Retry before signing.</p></div>'
          : ""
      }
      <section class="section">
        <div class="menu-list" role="group" aria-label="Argent multisig actions">
          ${walletMenuRow("multisig-watch", "Add shared account", "plus")}
          ${walletMenuRow("multisig-deploy", "Create a multisig", "users")}
        </div>
      </section>
      <section class="section">
        <p class="eyebrow">Shared accounts</p>
        ${
          account === null
            ? noAccountEmpty(status)
            : scoped.length === 0
              ? emptyState("No shared accounts are saved on this network yet.")
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
  signedPublicKeys: readonly string[] = [],
): readonly { readonly label: string; readonly value: string }[] =>
  view.config && view.authorityStatus === "available"
    ? accounts
        .filter(
          (account) =>
            account.networkId === view.record.networkId &&
            view.config?.signerGuids.includes(argentSignerGuid(account.publicKeyX)) &&
            !signedPublicKeys.some((publicKey) => sameFelt(publicKey, account.publicKeyX)),
        )
        .map((account) => ({
          label: accountDisplayName(account, preferences),
          value: account.id,
        }))
    : [];

const intentReviewAssets = (
  intent: ArgentMultisigSigningIntent,
  record: ArgentMultisigRecord,
  preferences: WalletPreferences | null,
) =>
  verificationContext(record, preferences ?? { addressBook: [], tokens: [] })
    .tokens.filter((token) =>
      intent.prepared.calls.some((call) => sameFelt(call.contractAddress, token.address)),
    )
    .map((token) => ({ address: token.address, symbol: token.symbol }));

const exactCalls = (intent: ArgentMultisigSigningIntent): string =>
  intent.prepared.calls
    .map(
      (call, index) => `<li class="review-panel">
        <p><strong>Call ${index + 1}</strong> · <code>${escapeHtml(call.entrypoint)}</code></p>
        <p>Contract · <code title="${escapeHtml(call.contractAddress)}">${escapeHtml(accountLabel(call.contractAddress))}</code></p>
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
    <ol>${current.signerPublicKeys.map((key) => `<li><code title="${escapeHtml(key)}">${escapeHtml(accountLabel(key))}</code></li>`).join("")}</ol>
    <p>Exact change</p>
    ${changedSigners.map((line) => `<p><code title="${escapeHtml(line)}">${escapeHtml(line.length > 24 ? `${line.slice(0, 14)}…${line.slice(-6)}` : line)}</code></p>`).join("")}
    <p>Resulting threshold · <strong>${review.nextConfig.threshold} of ${review.nextConfig.signerPublicKeys.length}</strong></p>
    <p>Resulting signers</p>
    <ol>${review.nextConfig.signerPublicKeys.map((key) => `<li><code title="${escapeHtml(key)}">${escapeHtml(accountLabel(key))}</code></li>`).join("")}</ol>
  </section>`;
};

const configMatchesIntent = (
  intent: ArgentMultisigSigningIntent,
  view: ArgentMultisigView,
): boolean => {
  const current = view.config;
  return (
    view.authorityStatus === "available" &&
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
  accountIntents: readonly ArgentMultisigSigningIntent[],
): string => {
  const outcome = multisigIntentOutcome(intent);
  if (outcome) return outcome;
  const isReplacement = isFeeReplacementIntent(intent, accountIntents);
  const hasReplacement = feeReplacementIntentFor(intent, accountIntents) !== null;
  const allOptions = localSignerOptions(view, status.accounts, preferences);
  const options = localSignerOptions(
    view,
    status.accounts,
    preferences,
    intent.signatures.map((signature) => signature.publicKey),
  );
  const hasFreshAuthority = configMatchesIntent(intent, view);
  const fee = preparedArgentMultisigFee(intent.prepared);
  const configReview = configReviewFor(intent, view);
  const reviewAssets = intentReviewAssets(intent, view.record, preferences);
  const transactionReview = verifyCalls(
    intent.prepared.calls.map((call) => ({ ...call, calldata: [...call.calldata] })),
    {
      ...verificationContext(view.record, preferences ?? { addressBook: [], tokens: [] }),
      ...(configReview ? { knownContracts: [view.record.address] } : {}),
    },
  );
  return `<article class="allowance-row multisig-intent" data-ms-intent="${escapeHtml(intent.id)}">
    <header class="decision-head">
      <span class="decision-seal">${icon("users")}</span>
      <span><p class="decision-label">${isReplacement ? "Fee-updated transaction" : intent.state === "stale" ? "Not submitted" : "Reviewed intent"}</p><h2>${escapeHtml(intent.summary)}</h2></span>
    </header>
    ${reviewCallsList(
      transactionReview.calls.map((call) => call.summary),
      reviewAssets,
    )}
    ${reviewPanel([
      ...riskFlagMessages(transactionReview.flags),
      ...(hasFreshAuthority
        ? []
        : [
            "The fresh on-chain signer authority does not exactly match this intent snapshot. Signing and submission are disabled.",
          ]),
    ])}
    <section class="decision-layer decision-boundary" aria-label="Maximum cost and constraints">
      <p class="decision-label">Maximum cost and constraints</p>
      ${receipt([
        { label: "Maximum network fee", value: formatFeeEstimate(fee) },
        {
          label: "Signatures",
          value: `${intent.signatures.length} of ${intent.configSnapshot.threshold}`,
        },
      ])}
    </section>
    <details class="disclosure decision-technical" data-disclosure="multisig-intent-${escapeHtml(intent.id)}">
      <summary>
        <span class="menu-copy"><strong>Technical details</strong><small>Exact identity, calls, and configuration</small></span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body">
        ${receipt(
          [
            {
              label: "Transaction hash",
              action: {
                attributes: { "data-copy": intent.prepared.transactionHash },
                icon: "copy",
                label: "Copy transaction hash",
              },
              value: accountLabel(intent.prepared.transactionHash),
              valueStyle: "code",
            },
            {
              label: "Sender",
              action: {
                attributes: { "data-copy": intent.prepared.senderAddress },
                icon: "copy",
                label: "Copy sender",
              },
              value: accountLabel(intent.prepared.senderAddress),
              valueStyle: "code",
            },
            {
              label: "Class hash",
              action: {
                attributes: { "data-copy": intent.configSnapshot.classHash },
                icon: "copy",
                label: "Copy class hash",
              },
              value: accountLabel(intent.configSnapshot.classHash),
              valueStyle: "code",
            },
            { label: "Chain ID", value: intent.prepared.chainId, valueStyle: "code" },
            { label: "Nonce", value: intent.prepared.nonce, valueStyle: "code" },
            { label: "Calls", value: String(intent.prepared.calls.length) },
          ],
          { "data-ms-exact-identity": "true" },
        )}
        ${configReview && view.record.currentConfig ? configReviewView(configReview, view.record.currentConfig) : ""}
        <ol class="allowance-list">${exactCalls(intent)}</ol>
        ${intentDeleteButton(intent.id, intent.accountId)}
      </div>
    </details>
    ${multisigIntentActions(intent, options, allOptions.length > 0, hasFreshAuthority, isReplacement, hasReplacement)}
  </article>`;
};

const intentList = (
  record: ArgentMultisigRecord,
  view: ArgentMultisigView,
  intents: readonly ArgentMultisigSigningIntent[],
  status: WalletStatus,
  preferences: WalletPreferences | null,
  selectedIntentId: string | null,
): string => {
  const all = intents.filter((intent) => intent.accountId === record.id);
  const scoped = selectedIntentId
    ? all.filter((intent) => intent.id === selectedIntentId)
    : actionableArgentMultisigIntents(all);
  if (selectedIntentId && scoped[0]) return intentCard(scoped[0], view, status, preferences, all);
  if (selectedIntentId) return emptyState("This signing intent is no longer available.");
  const submitted = scoped.find((intent) => intent.state === "submitted");
  if (submitted) return intentCard(submitted, view, status, preferences, all);
  const awaiting = scoped.filter(
    (intent) => intent.state === "collecting" || intent.state === "ready",
  );
  const stale = scoped.filter((intent) => intent.state === "stale");
  if (awaiting.length === 0 && stale.length === 0) {
    return emptyState("No intents are awaiting verification or signature.");
  }
  return `<div class="multisig-intent-stack">
    ${awaiting.length === 0 ? "" : `<section><p class="eyebrow">Awaiting verification &amp; signature</p><div class="allowance-list">${awaiting.map((intent) => intentCard(intent, view, status, preferences, all)).join("")}</div></section>`}
    ${stale.length === 0 ? "" : `<section><p class="eyebrow">Needs attention</p><div class="allowance-list">${stale.map((intent) => intentCard(intent, view, status, preferences, all)).join("")}</div></section>`}
  </div><p id="multisig-intent-result" role="status"></p>`;
};

const compactIntentList = (
  record: ArgentMultisigRecord,
  intents: readonly ArgentMultisigSigningIntent[],
  preferences: WalletPreferences | null,
): string => {
  const all = intents.filter((intent) => intent.accountId === record.id);
  const scoped = actionableArgentMultisigIntents(all);
  const heading = scoped.every((intent) => intent.state === "stale")
    ? "Needs attention"
    : scoped.some((intent) => intent.state === "stale")
      ? "Intents requiring action"
      : "Awaiting verification &amp; signature";
  return compactIntentListView(
    heading,
    scoped.map((intent) => ({
      accountId: record.id,
      assets: intentReviewAssets(intent, record, preferences),
      id: intent.id,
      label: intent.summary,
      supportingText: `${
        isFeeReplacementIntent(intent, all)
          ? "Fee updated · fresh approvals"
          : intent.state === "ready"
            ? "Ready to submit"
            : intent.state === "stale"
              ? intent.signatures.length === intent.configSnapshot.threshold
                ? "Not submitted · ready to retry"
                : "Not submitted · needs review"
              : "Awaiting signatures"
      } · ${intent.signatures.length} of ${intent.configSnapshot.threshold}`,
    })),
    "No intents are awaiting verification or signature. Import one to review it here.",
  );
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
  selectedIntentId: string | null = null,
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
  const storedConfig = record.currentConfig ?? record.deployment;
  const hasCompleteSignerConfig =
    view.config !== null &&
    storedConfig !== undefined &&
    storedConfig.threshold === view.config.threshold &&
    storedConfig.signerPublicKeys.length === view.config.signerGuids.length &&
    storedConfig.signerPublicKeys.every((key, index) =>
      sameFelt(argentSignerGuid(key), view.config?.signerGuids[index] ?? ""),
    );
  const openCount = actionableArgentMultisigIntents(
    intents.filter((intent) => intent.accountId === record.id),
  ).length;
  const authorityIssue = authorityMessage(view);
  const effectiveAuthorityIssue = loadError
    ? "Signer authority could not be refreshed. Retry before preparing or signing."
    : authorityIssue;
  const authorityWarning =
    screen === "multisig-home" || (!loadError && authorityIssue === null)
      ? ""
      : view.deployed === false
        ? '<div class="review-panel" role="status"><p class="review-flag">This account is not deployed yet. Deploy it before preparing or signing transactions.</p></div>'
        : `<div class="review-panel" role="alert"><p class="review-flag">${escapeHtml(loadError ? "The latest signer-authority refresh failed. Signing remains disabled until retry succeeds." : (authorityIssue ?? "Current signer authority is unavailable."))}</p></div>`;
  if (screen === "multisig-detail") {
    return (
      flowHeader(multisigDisplayName(record), status, configLabel(view)) +
      flowScreen(
        screen,
        `<section class="section multisig-review-flow">${authorityWarning}${intentList(record, view, intents, status, preferences, selectedIntentId)}</section><p id="multisig-detail-result" role="status"></p>`,
      )
    );
  }
  return dockScreen(
    screen,
    `${authorityWarning}
      ${multisigPortfolio({
        authorityAvailable: !loadError && view.config !== null,
        ...(effectiveAuthorityIssue ? { authorityMessage: effectiveAuthorityIssue } : {}),
        canSign:
          !loadError && view.deployed === true && options.length > 0 && hasCompleteSignerConfig,
        data: portfolio,
        ...(view.deployed === undefined ? {} : { deployed: view.deployed }),
        ...(view.deploymentPending ? { deploymentPending: true } : {}),
        intents: compactIntentList(record, intents, preferences),
        openCount,
        preferences,
        record,
        signerKnown: options.length > 0,
      })}
      <p id="multisig-detail-result" role="status"></p>`,
  );
};
