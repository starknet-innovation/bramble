/** Pure screens for stable Argent multisig accounts and frozen intents. */
import { escapeHtml } from "@bramble/core/html";
import type {
  ArgentMultisigRecord,
  ArgentMultisigSigningIntent,
} from "@bramble/multisig/repository";
import type { WalletPreferences } from "@bramble/settings/preferences";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { preparedArgentMultisigFee } from "@bramble/starknet/multisig-invoke";
import { verificationContext, verifyCalls } from "@bramble/transactions/verify";
import { emptyState, receipt } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { menuRow } from "@bramble/ui-kit/navigation";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { sameFelt } from "@bramble/wallet-model/networks";
import { t, th } from "../../../i18n/messages";
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
import {
  multisigIntentActions,
  multisigIntentOutcome,
  staleIntentLabel,
} from "./multisig-intent-actions";
import { type CompactIntentList, intentDeleteButton } from "./multisig-intent-list";
import { configReviewFor, configReviewView, exactCalls } from "./multisig-intent-review";
import {
  actionableArgentMultisigIntents,
  feeReplacementIntentFor,
  isFeeReplacementIntent,
  multisigDisplayName,
} from "./multisig-model";
import { multisigPortfolio } from "./multisig-portfolio";
import { EMPTY_MULTISIG_PORTFOLIO, type MultisigPortfolioData } from "./multisig-portfolio-data";
import { multisigStrk20KeyPanel } from "./multisig-strk20-key-view";

export { multisigDeployFlow } from "./multisig-deploy-view";
export { multisigDisplayName } from "./multisig-model";
export { multisigProposeFlow } from "./multisig-propose-view";

const configLabel = (view: ArgentMultisigView): string =>
  view.config
    ? `${t("multisig.config.threshold", { threshold: String(view.config.threshold), total: String(view.config.signerGuids.length) })}${view.authorityStatus === "unsupported-signers" ? ` · ${t("multisig.config.watchOnly")}` : ""}`
    : {
        available: t("multisig.config.unavailable"),
        "invalid-config": t("multisig.config.invalid"),
        "network-unavailable": t("multisig.config.authorityUnavailable"),
        undeployed: t("multisig.config.notDeployed"),
        "unsupported-class": t("multisig.config.unsupportedClass"),
        "unsupported-signers": t("multisig.config.unsupportedSigners"),
      }[view.authorityStatus];

const authorityMessage = (view: ArgentMultisigView): string | null =>
  ({
    available: null,
    "invalid-config": t("multisig.authority.invalidConfig"),
    "network-unavailable": t("multisig.authority.networkUnavailable"),
    undeployed: null,
    "unsupported-class": t("multisig.authority.unsupportedClass"),
    "unsupported-signers": t(
      view.unsupportedSigners.length === 1
        ? "multisig.authority.unsupportedSignerOne"
        : "multisig.authority.unsupportedSignerMany",
    ),
  })[view.authorityStatus];

const multisigRow = (view: ArgentMultisigView, openCount: number): string => `
  <li class="allowance-row">
    ${menuRow({
      attributes: { "data-multisig-open": view.record.id },
      icon: "wallet",
      label: multisigDisplayName(view.record),
      supportingText: `${configLabel(view)}${openCount > 0 ? ` · ${t("multisig.list.open", { count: String(openCount) })}` : ""}`,
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
      t("multisig.list.title"),
      status,
      t(scoped.length === 1 ? "multisig.list.countOne" : "multisig.list.countMany", {
        count: String(scoped.length),
      }),
    ) +
    flowScreen(
      "multisigs",
      `${
        loadError
          ? `<div class="review-panel" role="alert"><p class="review-flag">${th("multisig.list.registryFailed")}</p></div>`
          : ""
      }
      <section class="section">
        <div class="menu-list" role="group" aria-label="${th("multisig.list.actions")}">
          ${walletMenuRow("multisig-watch", t("multisig.list.add"), "plus")}
          ${walletMenuRow("multisig-deploy", t("multisig.list.create"), "users")}
        </div>
      </section>
      <section class="section">
        <p class="eyebrow">${th("multisig.list.title")}</p>
        ${
          account === null
            ? noAccountEmpty(status)
            : scoped.length === 0
              ? emptyState(t("multisig.list.empty"))
              : `<ul class="allowance-list">${scoped.map((view) => multisigRow(view, openCount(view.record))).join("")}</ul>`
        }
        ${loadError ? button({ attributes: { id: "multisig-list-retry" }, label: t("multisig.retry") }) : ""}
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
      <span><p class="decision-label">${isReplacement ? th("review.multisig.card.feeUpdated") : intent.state === "stale" ? th("review.multisig.stale.label") : th("review.multisig.card.reviewed")}</p><h2>${escapeHtml(intent.summary)}</h2></span>
    </header>
    ${reviewCallsList(
      transactionReview.calls.map((call) => call.summary),
      reviewAssets,
    )}
    ${reviewPanel([
      ...riskFlagMessages(transactionReview.flags),
      ...(hasFreshAuthority ? [] : [t("review.multisig.card.signersChanged")]),
    ])}
    <section class="decision-layer decision-boundary" aria-label="${th("review.multisig.card.cost")}">
      <p class="decision-label">${th("review.multisig.card.cost")}</p>
      ${receipt([
        { label: t("review.multisig.card.maxFee"), value: formatFeeEstimate(fee) },
        {
          label: t("review.multisig.card.signatures"),
          value: t("review.multisig.card.signatureCount", {
            signed: String(intent.signatures.length),
            threshold: String(intent.configSnapshot.threshold),
          }),
        },
      ])}
    </section>
    <details class="disclosure decision-technical" data-disclosure="multisig-intent-${escapeHtml(intent.id)}">
      <summary>
        <span class="menu-copy"><strong>${th("review.multisig.technical.title")}</strong><small>${th("review.multisig.technical.hint")}</small></span>
        <span class="disclosure-mark">${icon("chevronRight")}</span>
      </summary>
      <div class="disclosure-body">
        ${receipt(
          [
            {
              label: t("review.multisig.technical.hash"),
              action: {
                attributes: { "data-copy": intent.prepared.transactionHash },
                icon: "copy",
                label: t("review.multisig.technical.copyHash"),
              },
              value: accountLabel(intent.prepared.transactionHash),
              valueStyle: "code",
            },
            {
              label: t("review.multisig.technical.sender"),
              action: {
                attributes: { "data-copy": intent.prepared.senderAddress },
                icon: "copy",
                label: t("review.multisig.technical.copySender"),
              },
              value: accountLabel(intent.prepared.senderAddress),
              valueStyle: "code",
            },
            {
              label: t("review.multisig.technical.classHash"),
              action: {
                attributes: { "data-copy": intent.configSnapshot.classHash },
                icon: "copy",
                label: t("review.multisig.technical.copyClassHash"),
              },
              value: accountLabel(intent.configSnapshot.classHash),
              valueStyle: "code",
            },
            {
              label: t("review.multisig.technical.chainId"),
              value: intent.prepared.chainId,
              valueStyle: "code",
            },
            {
              label: t("review.multisig.technical.nonce"),
              value: intent.prepared.nonce,
              valueStyle: "code",
            },
            {
              label: t("review.multisig.technical.calls"),
              value: String(intent.prepared.calls.length),
            },
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
  if (selectedIntentId) return emptyState(t("multisig.intents.gone"));
  const submitted = scoped.find((intent) => intent.state === "submitted");
  if (submitted) return intentCard(submitted, view, status, preferences, all);
  const awaiting = scoped.filter(
    (intent) => intent.state === "collecting" || intent.state === "ready",
  );
  const stale = scoped.filter((intent) => intent.state === "stale");
  if (awaiting.length === 0 && stale.length === 0) {
    return emptyState(t("multisig.intents.nothing"));
  }
  return `<div class="multisig-intent-stack">
    ${awaiting.length === 0 ? "" : `<section><p class="eyebrow">${th("multisig.intents.waiting")}</p><div class="allowance-list">${awaiting.map((intent) => intentCard(intent, view, status, preferences, all)).join("")}</div></section>`}
    ${stale.length === 0 ? "" : `<section><p class="eyebrow">${th("multisig.intents.attention")}</p><div class="allowance-list">${stale.map((intent) => intentCard(intent, view, status, preferences, all)).join("")}</div></section>`}
  </div><p id="multisig-intent-result" role="status"></p>`;
};

const compactIntentList = (
  record: ArgentMultisigRecord,
  intents: readonly ArgentMultisigSigningIntent[],
  preferences: WalletPreferences | null,
): CompactIntentList => {
  const all = intents.filter((intent) => intent.accountId === record.id);
  const scoped = actionableArgentMultisigIntents(all);
  const heading = scoped.every((intent) => intent.state === "stale")
    ? t("multisig.intents.attention")
    : scoped.some((intent) => intent.state === "stale")
      ? t("multisig.intents.needingYou")
      : t("multisig.intents.waiting");
  return {
    emptyMessage: t("multisig.intents.nothingImport"),
    heading,
    items: scoped.map((intent) => ({
      accountId: record.id,
      assets: intentReviewAssets(intent, record, preferences),
      id: intent.id,
      label: intent.summary,
      supportingText: `${
        isFeeReplacementIntent(intent, all)
          ? t("multisig.intents.feeUpdated")
          : intent.state === "ready"
            ? t("multisig.intents.readyToSubmit")
            : intent.state === "stale"
              ? intent.signatures.length === intent.configSnapshot.threshold
                ? `${staleIntentLabel()} · ${t("multisig.intents.readyToRetry")}`
                : `${staleIntentLabel()} · ${t("multisig.intents.needsReview")}`
              : t("multisig.intents.awaiting")
      } · ${t("multisig.intents.signatureCount", { signed: String(intent.signatures.length), threshold: String(intent.configSnapshot.threshold) })}`,
    })),
  };
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
      (screen === "multisig-home" ? "" : flowHeader(t("multisig.detail.title"), status)) +
      (screen === "multisig-home" ? dockScreen : flowScreen)(
        screen,
        emptyState(t("multisig.detail.unwatched")),
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
    ? t("multisig.authority.refreshFailedRetry")
    : authorityIssue;
  const authorityWarning =
    screen === "multisig-home" || (!loadError && authorityIssue === null)
      ? ""
      : view.deployed === false
        ? `<div class="review-panel" role="status"><p class="review-flag">${th("multisig.detail.notDeployed")}</p></div>`
        : `<div class="review-panel" role="alert"><p class="review-flag">${escapeHtml(loadError ? t("multisig.authority.latestRefreshFailed") : (authorityIssue ?? t("multisig.authority.currentUnavailable")))}</p></div>`;
  if (screen === "multisig-detail") {
    return (
      flowHeader(multisigDisplayName(record), status, configLabel(view)) +
      flowScreen(
        screen,
        `<section class="section multisig-review-flow">${authorityWarning}${intentList(record, view, intents, status, preferences, selectedIntentId)}${multisigStrk20KeyPanel(record.networkId, preferences, portfolio)}</section><p id="multisig-detail-result" role="status"></p>`,
      )
    );
  }
  return dockScreen(
    screen,
    `${authorityWarning}
      ${multisigPortfolio({
        authorityAvailable: !loadError && view.config !== null,
        ...(effectiveAuthorityIssue ? { authorityMessage: effectiveAuthorityIssue } : {}),
        canPropose: !loadError && view.deployed === true && hasCompleteSignerConfig,
        data: portfolio,
        ...(view.deployed === undefined ? {} : { deployed: view.deployed }),
        ...(view.deploymentPending ? { deploymentPending: true } : {}),
        intentList: compactIntentList(record, intents, preferences),
        openCount,
        preferences,
        record,
        signerKnown: options.length > 0,
      })}
      <p id="multisig-detail-result" role="status"></p>`,
  );
};
