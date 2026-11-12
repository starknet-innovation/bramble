/**
 * Approved copy for the shadow-account approval card (#443, PR 4; copy review
 * b1004-b1026). The wording lives in the pinned `./review-messages.ts` catalog;
 * each line here builds its reference, and its English rendering for callers
 * that only need text.
 *
 * These are approval sentences, so they are edited against "did we lose a
 * fact?" (docs/COPY_STYLE.md), never shortened for length.
 */
import type { MessageRef } from "@bramble/core/i18n";
import { strk20English, strk20Text } from "./review-messages";

/** What runs, through which shadow account, for which site. Issue wording. */
export const shadowInvokeRunsText = (calls: number, nonce: string, origin: string): MessageRef =>
  strk20Text(calls === 1 ? "strk20Review.shadow.runsOne" : "strk20Review.shadow.runsMany", {
    count: String(calls),
    nonce,
    origin,
  });

/** The configured anonymizer the calls run through. Mirrors "Privacy pool <address>". */
export const shadowInvokeAnonymizerText = (address: string): MessageRef =>
  strk20Text("strk20Review.shadow.anonymizer", { address });

/** The tokens the invoke settles back into private notes. Issue wording. */
export const shadowInvokeSettlesText = (tokens: string): MessageRef =>
  strk20Text("strk20Review.shadow.settles", { tokens });

/**
 * The tokens the invoke settles into a private note for someone other than
 * this account. Mirrors "Transfer … privately to <address>".
 */
export const shadowInvokeSettlesToText = (tokens: string, recipient: string): MessageRef =>
  strk20Text("strk20Review.shadow.settlesTo", { recipient, tokens });

/**
 * `collect_policy: all` with an OPEN note for someone other than this account:
 * the shadow account's whole balance of those tokens goes to them, including
 * what earlier calls left behind.
 */
export const shadowInvokeCollectsAllToText = (tokens: string, recipient: string): MessageRef =>
  strk20Text("strk20Review.shadow.collectsAllTo", { recipient, tokens });

/** No OPEN transfer in the batch: nothing returns to the private balance. Issue wording, negated. */
export const SHADOW_INVOKE_SETTLES_NOTHING_TEXT: MessageRef = strk20Text(
  "strk20Review.shadow.settlesNothing",
);

/**
 * Who can move what the calls leave behind: this wallet only, through the site
 * or with the native sweep (copy review b1010).
 */
export const SHADOW_INVOKE_CONTROL_TEXT: MessageRef = strk20Text("strk20Review.shadow.control");

/** The sweep review's first line (#443, PR 5). Mirrors the runs line. */
export const shadowSweepSummaryText = (nonce: string, origin: string): MessageRef =>
  strk20Text("strk20Review.shadow.sweep", { nonce, origin });

/** English renderings of the lines above, as they have always read. */
export const SHADOW_INVOKE_RUNS = (calls: number, nonce: string, origin: string): string =>
  strk20English(shadowInvokeRunsText(calls, nonce, origin));
/** English of {@link shadowInvokeAnonymizerText}. */
export const SHADOW_INVOKE_ANONYMIZER = (address: string): string =>
  strk20English(shadowInvokeAnonymizerText(address));
/** English of {@link shadowInvokeSettlesText}. */
export const SHADOW_INVOKE_SETTLES = (tokens: string): string =>
  strk20English(shadowInvokeSettlesText(tokens));
/** English of {@link shadowInvokeSettlesToText}. */
export const SHADOW_INVOKE_SETTLES_TO = (tokens: string, recipient: string): string =>
  strk20English(shadowInvokeSettlesToText(tokens, recipient));
/** English of {@link shadowInvokeCollectsAllToText}. */
export const SHADOW_INVOKE_COLLECTS_ALL_TO = (tokens: string, recipient: string): string =>
  strk20English(shadowInvokeCollectsAllToText(tokens, recipient));
/** English of {@link SHADOW_INVOKE_SETTLES_NOTHING_TEXT}. */
export const SHADOW_INVOKE_SETTLES_NOTHING = strk20English(SHADOW_INVOKE_SETTLES_NOTHING_TEXT);
/** English of {@link SHADOW_INVOKE_CONTROL_TEXT}. */
export const SHADOW_INVOKE_CONTROL = strk20English(SHADOW_INVOKE_CONTROL_TEXT);
/** English of {@link shadowSweepSummaryText}. */
export const SHADOW_SWEEP_SUMMARY = (nonce: string, origin: string): string =>
  strk20English(shadowSweepSummaryText(nonce, origin));

/**
 * The activity line a settled sweep records. Activity is plain data
 * outside the encrypted vault and goes out in the CSV export, so it names no
 * site, label, or nonce: those are scope-record facts, which stay in the vault
 * (audit F2). Activity summaries are data (dedup guards match on them), so this
 * is fixed before it first ships.
 */
export const SHADOW_SWEEP_ACTIVITY = "Sweep shadow account";
