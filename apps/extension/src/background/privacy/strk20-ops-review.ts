/**
 * What a STRK20 dapp request's card states, and how a disclosure request is
 * queued, split from ./strk20-ops to keep that module within the size budget.
 *
 * Trust boundary: every request here comes from an untrusted page. Anything the
 * site can observe at once — an instant refusal, how soon it arrives — must not
 * depend on what this user has set up (an anonymizer, tracked tokens, the
 * shadow-account record table), or the site reads that setup without the user
 * seeing anything (#443, audit N1). So a batch's summary bound is decided from
 * the site's input alone, and a request that needs the anonymizer is held on
 * the wallet's notice whenever it fails after that point, exactly as the
 * not-configured path is.
 */

import {
  type Strk20AssetLookup,
  type Strk20ShadowAccountReview,
  summarizeStrk20Batch,
} from "@bramble/privacy/service";
import { activityOrigin } from "@bramble/transactions/activity";
import { verificationContext } from "@bramble/transactions/verify";
import { sameFelt } from "@bramble/wallet-model/networks";
import type { ApprovalRiskFlag } from "@bramble/wallet-protocol/extension-responses";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { createApprovalContext } from "../approvals/approval-context";
import { notifyApprovalsChanged } from "../approvals/approval-notifier";
import { requireRenderableSummaries } from "../approvals/approval-summary-bound";
import type { ApprovalQueue } from "../approvals/approvals";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { type ResolvedAccount, strk20ErrorMessage } from "./strk20-approval-execution";
import type {
  Strk20DisclosureApprovalKind,
  Strk20DisclosureRequest,
} from "./strk20-approval-types";
import { holdStrk20Notice } from "./strk20-notice";
import { disclosureScopeRecording, shadowRecordRefusal } from "./strk20-shadow-scopes";

/** The token addresses a batch names, in batch order. */
export const actionTokenAddresses = (actions: readonly Strk20Action[]): readonly string[] =>
  actions.flatMap((action) => ("token" in action ? [action.token] : []));

/**
 * Card labels come from the same network-scoped, spam- and source-filtered
 * trusted set the call reviewer uses, never raw preferences: a dapp-watched or
 * spoof token must not lend its ticker to a card (audit 171).
 */
export const reviewAssetsFor = (
  resolved: ResolvedAccount,
  addresses: readonly string[],
): readonly { readonly address: string; readonly symbol: string }[] =>
  verificationContext(resolved.account, resolved.preferences)
    .tokens.filter((token) => addresses.some((address) => sameFelt(address, token.address)))
    .map((token) => ({ address: token.address, symbol: token.symbol }));

// Action amounts on a card read in the token's own units only for a token in
// that same trusted set (Sherlock 154); any other token keeps its exact felt.
const trustedAssetLookup = (resolved: ResolvedAccount): Strk20AssetLookup => {
  const tokens = verificationContext(resolved.account, resolved.preferences).tokens;
  return (address) => {
    const token = tokens.find((candidate) => sameFelt(candidate.address, address));
    return token ? { decimals: token.decimals, symbol: token.symbol } : undefined;
  };
};

/** The anonymizer configured for the account's network, if any. */
export const configuredAnonymizer = (resolved: ResolvedAccount): string | undefined =>
  resolved.preferences.strk20Networks?.[resolved.account.networkId]?.shadowAccountAnonymizerAddress;

/** Whether a batch can only run through the configured anonymizer. */
export const needsAnonymizer = (actions: readonly Strk20Action[]): boolean =>
  actions.some((action) => action.type === "shadow_account_invoke");

/**
 * What the card states for a batch, and the anonymizer it named. The
 * anonymizer is bound into the approval so execution can refuse if the
 * network's configuration moved after review: the calls the user reviewed
 * would otherwise run through a different anonymizer than the card showed.
 */
export const batchReview = (
  resolved: ResolvedAccount,
  origin: string,
  actions: readonly Strk20Action[],
): { readonly anonymizer?: string; readonly summaries: readonly string[] } => {
  const anonymizer = needsAnonymizer(actions) ? configuredAnonymizer(resolved) : undefined;
  const shadow: Strk20ShadowAccountReview | undefined =
    anonymizer === undefined ? undefined : { anonymizer, origin: activityOrigin(origin) };
  return {
    ...(anonymizer === undefined ? {} : { anonymizer }),
    summaries: summarizeStrk20Batch(actions, {
      assetFor: trustedAssetLookup(resolved),
      depositor: resolved.account.address,
      ...(shadow ? { shadow } : {}),
    }),
  };
};

// Wider than every token label a card can print: a trusted ticker (at most 12
// characters plus a bridged ".e") or a shortened address (13).
const WIDEST_TOKEN_LABEL = "X".repeat(16);
// A full-width felt, at least as long as any configured anonymizer address.
const WIDEST_FELT = `0x${"f".repeat(64)}`;
// Every token reads as trusted under the widest label. Decimals 0 keep each
// amount an integer; an amount line stays far below the panel's bound at any
// width (a 78-digit amount and two shortened addresses), so only the joined
// token list of a settle line can reach it, and that list is never narrower
// here than on the real card.
const widestAsset: Strk20AssetLookup = () => ({ decimals: 0, symbol: WIDEST_TOKEN_LABEL });

/**
 * The refusal for a batch whose card the panel could not render, decided from
 * the site's input alone, or null when it fits (audit N1). The real card names
 * a tracked token by its ticker and an untracked one by its address, so
 * measuring the real text let a site read which tokens the user tracks — and,
 * because only a configured anonymizer reaches a card, that one is configured.
 * Measured instead with every token label, and the anonymizer, at the widest
 * the card could print, the answer is the same for every user; a batch that
 * passes here also passes the queue's own check on the real card.
 * `depositor` is the connected account the site already knows.
 */
export const strk20BatchSummaryRefusal = (
  actions: readonly Strk20Action[],
  origin: string,
  depositor: string,
): string | null => {
  try {
    requireRenderableSummaries({
      summaries: summarizeStrk20Batch(actions, {
        assetFor: widestAsset,
        depositor,
        shadow: { anonymizer: WIDEST_FELT, origin: activityOrigin(origin) },
      }),
    });
    return null;
  } catch (error) {
    return strk20ErrorMessage(error);
  }
};

/** What {@link queueStrk20Disclosure} needs from the STRK20 handler deps. */
export type Strk20DisclosureDeps = {
  readonly approvals: ApprovalQueue;
  readonly wallet: WalletStatusReader;
  readonly waiters: { readonly register: (id: string) => Promise<RuntimeResponse> };
};

/**
 * Queues a disclosure approval and holds the site's response on it. A full
 * shadow-account record table is held on its own notice. When `holdFailures`
 * is set — the request can only reach a card with an anonymizer configured —
 * any other failure to queue the card is held on the "request-failed" notice
 * too, as on the invoke path: an instant answer would tell the site the
 * anonymizer exists. Otherwise the failure is returned at once.
 */
export const queueStrk20Disclosure = async (
  deps: Strk20DisclosureDeps,
  resolved: ResolvedAccount,
  input: {
    readonly flags?: readonly ApprovalRiskFlag[];
    readonly holdFailures: boolean;
    readonly kind: Strk20DisclosureApprovalKind;
    readonly origin: string;
    readonly request: Strk20DisclosureRequest;
    readonly summaries: readonly string[];
  },
): Promise<RuntimeResponse> => {
  const recording = disclosureScopeRecording(input.request);
  const unrecordable = await shadowRecordRefusal(deps.wallet, resolved, input.origin, recording);
  if (unrecordable) {
    return holdStrk20Notice(deps, input.origin, unrecordable.error, "record-limit");
  }
  try {
    const payload = { strk20Request: input.request };
    const approval = deps.approvals.requestStrk20Disclosure({
      context: await createApprovalContext(resolved.account, payload),
      ...(input.flags === undefined ? {} : { flags: input.flags }),
      kind: input.kind,
      origin: input.origin,
      request: input.request,
      reviewAssets: reviewAssetsFor(
        resolved,
        input.request.type === "register"
          ? [input.request.token]
          : input.request.type === "balances"
            ? input.request.tokens
            : input.request.type === "prepare"
              ? actionTokenAddresses(input.request.actions)
              : [],
      ),
      summaries: input.summaries,
    });
    notifyApprovalsChanged();
    return deps.waiters.register(approval.id);
  } catch (error) {
    return input.holdFailures
      ? holdStrk20Notice(deps, input.origin, strk20ErrorMessage(error), "request-failed")
      : { error: strk20ErrorMessage(error) };
  }
};
