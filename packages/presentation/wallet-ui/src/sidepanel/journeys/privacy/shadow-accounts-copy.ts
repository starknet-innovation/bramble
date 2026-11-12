/**
 * Approved copy for the Shadow accounts view and sweep (issue 443, PR 5; copy
 * review b1012-b1020). One function per line, read from the `privacy.shadow.*`
 * catalog so it follows the active language. The reason line carries the
 * issue's required disclosure: balances are read only on request because the
 * reads link these addresses at the RPC provider.
 */
import { t } from "../../../i18n/messages";

/**
 * The view title as the shared view-label map and the settings row read it.
 * Those English lookups belong to their own areas; this screen uses
 * {@link shadowAccountsTitle}.
 */
export const SHADOW_ACCOUNTS_TITLE = "Shadow accounts";

/** Settings row and view title, in the active language. */
export const shadowAccountsTitle = (): string => t("privacy.shadow.title");

/** Why balances wait for a tap. Issue wording, as one sentence. */
export const shadowAccountsReadReason = (): string => t("privacy.shadow.readReason");

/** Empty state: no scope recorded for this account, network, and pool. */
export const shadowAccountsEmpty = (): string => t("privacy.shadow.empty");

/** A scope recorded under an anonymizer the network no longer uses. */
export const shadowAccountsOtherAnonymizer = (address: string): string =>
  t("privacy.shadow.otherAnonymizer", { address });

/** The per-scope network read. */
export const shadowAccountsCheck = (): string => t("privacy.shadow.check");

/** A shadow account with nothing the wallet tracks. */
export const shadowAccountsNothingHeld = (): string => t("privacy.shadow.nothingHeld");

/** A listed shadow account not yet deployed (it may still hold funds). */
export const shadowAccountsUndeployed = (): string => t("privacy.shadow.undeployed");

/** Recorded nonces the anonymizer's view cannot list. */
export const shadowAccountsUnlisted = (nonces: string): string =>
  t("privacy.shadow.unlisted", { nonces });

/** The sweep control, which starts the sweep's review. */
export const shadowAccountsSweep = (): string => t("privacy.shadow.sweep");

/**
 * The sweep's confirmation, after its review is shown. Signing text: it stays
 * English until the review-screens change translates it under pinning.
 */
export const SHADOW_ACCOUNTS_CONFIRM_SWEEP = "Confirm sweep";

/** After the relay accepted the sweep. */
export const shadowAccountsSweepSent = (): string => t("privacy.shadow.sweepSent");

/** While the records load from the vault. Mirrors "Loading allowances…". */
export const shadowAccountsLoading = (): string => t("privacy.shadow.loading");
