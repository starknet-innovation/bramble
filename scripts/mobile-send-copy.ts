/**
 * Renders `SendCopy.generated.swift` and `SendCopy.generated.kt` from the copy section of the
 * transaction fixture, so the mobile Send screens show the extension's strings without anyone
 * retyping them. Each entry names the extension source it was read from (a rendered section and
 * position, or an exported constant); a copy change in the extension changes these files and
 * fails the drift gate in `tests/conformance/mobile-generated.test.ts`.
 */

/** Repository-relative paths of the generated copy tables. */
export const SEND_COPY_SWIFT_PATH = "mobile/ios/Bramble/Send/SendCopy.generated.swift";
export const SEND_COPY_KOTLIN_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/send/SendCopy.generated.kt";

type Json = Record<string, unknown>;

const at = (value: unknown, ...path: (number | string)[]): string => {
  let cursor: unknown = value;
  for (const key of path) {
    cursor = (cursor as Json | unknown[] | undefined)?.[key as never];
  }
  if (typeof cursor !== "string") {
    throw new Error(`copy fixture has no string at ${path.join(".")}`);
  }
  return cursor;
};

const before = (text: string, marker: string): string => {
  const index = text.indexOf(marker);
  if (index < 0) throw new Error(`"${marker}" not found in "${text}"`);
  return text.slice(0, index + marker.length);
};

/** Every string the mobile Send journey shows, in a stable order. */
export const sendCopyEntries = (copy: Json): readonly (readonly [string, string])[] => {
  const screens = copy["screens"] as Json;
  const section = (id: string) => (screens["sections"] as Json)[id] as Json;
  const title = (stage: string) => {
    const entry = (copy["stageTitles"] as { stage: string; title: string }[]).find(
      (e) => e.stage === stage,
    );
    if (!entry) throw new Error(`no title for ${stage}`);
    return entry.title;
  };
  const outcome = (status: string, key: string) =>
    at(
      (copy["confirmationOutcomes"] as { status: string }[]).find((e) => e.status === status),
      "outcome",
      key,
    );
  const recipient = section("send-recipient-stage");
  const details = section("send-details");
  const pending = section("send-pending");
  const success = section("send-success");
  const failure = section("send-failure");
  const fee = copy["reviewFee"] as Json;
  const failures = copy["failures"] as Json;
  const refusals = copy["refusals"] as Json;
  const working = copy["working"] as Json;
  const deploy = screens["deployAccount"] as Json;
  // "Creating this account on Starknet is 0.005 STRK of that.": the amount is the review's own.
  const deploymentShare = at(fee, "undeployedKnown", 2);
  const [sharePrefix = "", shareSuffix = ""] = deploymentShare.split("0.005 STRK");
  return [
    ["titleRecipient", title("recipient")],
    ["titleDetails", title("details")],
    ["titleReview", title("review")],
    ["titleAuthorizing", title("authorizing")],
    ["titleBroadcasting", title("broadcasting")],
    ["titleConfirming", title("confirming")],
    ["titlePending", title("pending")],
    ["titleSubmitted", title("submitted")],
    ["titleFailed", title("failed")],
    ["amountLabel", at(copy, "mode", "amountLabel")],
    ["reviewLabel", at(copy, "mode", "reviewLabel")],
    ["preparing", at(copy, "mode", "preparing")],
    ["confirmLabel", at(copy, "mode", "confirmLabel")],
    ["progressLabel", at(copy, "mode", "progressLabel")],
    ["sendFrom", at(recipient, "text", 0)],
    ["sendTo", at(recipient, "text", 3)],
    ["addressBook", at(recipient, "text", 4)],
    ["saveRecipient", at(recipient, "text", 5)],
    ["myAccounts", at(recipient, "text", 6)],
    ["currentAccount", at(recipient, "text", 10)],
    ["noMatchingRecipient", at(recipient, "text", 11)],
    ["continueWithAddress", at(recipient, "text", 12)],
    ["copySendingAddress", at(recipient, "ariaLabels", 0)],
    ["recipientPlaceholder", at(recipient, "placeholders", 0)],
    ["recipientFieldLabel", at(recipient, "ariaLabels", 1)],
    ["invalidRecipient", at(refusals, "invalidRecipient")],
    ["accountsHeading", at(details, "text", 0)],
    ["fromLabel", at(details, "text", 1)],
    ["toLabel", at(details, "text", 5)],
    ["networkLabel", at(details, "text", 9)],
    ["assetLabel", at(details, "text", 12)],
    ["tokensYouCanSend", at(details, "ariaLabels", 4)],
    ["yourTokens", at(details, "text", 14)],
    ["manageTokens", at(details, "text", 17)],
    ["half", at(details, "text", 20)],
    ["max", at(details, "text", 21)],
    ["estimatedValueUnavailable", at(details, "text", 23)],
    ["amountPlaceholder", at(details, "placeholders", 0)],
    ["balanceUnavailable", at(screens, "balanceLines", 0, "line")],
    ["balancePrefix", before(at(screens, "balanceLines", 1, "line"), " ")],
    ["amountGate", at(screens, "amountGate")],
    ["amountInvalid", at(copy, "amountErrors", "invalid")],
    ["amountNotPositive", at(copy, "amountErrors", "notPositive")],
    ["amountTooManyDecimals", at(copy, "amountErrors", "tooManyDecimals")],
    ["fromRowLabel", at(screens, "review", "summary", 0)],
    ["toRowLabel", at(screens, "review", "summary", 5)],
    ["amountRowLabel", at(screens, "review", "summary", 10)],
    ["fiatUnavailable", at(screens, "review", "summary", 12)],
    ["showFullSender", at(screens, "review", "summary", 3)],
    ["showFullRecipient", at(screens, "review", "summary", 8)],
    ["copyRecipient", at(screens, "review", "summaryLabels", 0)],
    ["riskAndRecovery", at(screens, "review", "risksUndeployed", 0)],
    ["deployNote", at(screens, "review", "risksUndeployed", 1)],
    ["cost", at(fee, "deployedKnown", 0)],
    ["feePrefix", before(at(fee, "deployedKnown", 1), ": ")],
    ["deploymentSharePrefix", sharePrefix],
    ["deploymentShareSuffix", shareSuffix],
    ["feeFailed", at(fee, "deployedFailed", 1)],
    ["feesFailed", at(fee, "undeployedFailed", 1)],
    ["retryFee", at(fee, "deployedFailed", 2)],
    ["shortfall", at(screens, "review", "shortfall", 2)],
    ["feeUnavailableBlock", at(copy, "reviewBlocks", "feeUnavailable")],
    ["poisonedBlock", at(copy, "reviewBlocks", "poisoned")],
    ["workingTitle", at(working, "authorizing", "title")],
    ["successTitle", at(success, "text", 0)],
    ["transactionLabel", at(success, "text", 1)],
    ["viewActivity", at(success, "text", 2)],
    ["back", at(success, "text", 3)],
    ["copyTransactionHash", at(success, "ariaLabels", 0)],
    ["pendingKicker", at(pending, "text", 0)],
    ["pendingTitle", at(pending, "text", 1)],
    ["pendingBody", at(pending, "text", 2)],
    ["checkConfirmation", at(pending, "text", 3)],
    ["failureTitle", at(failure, "text", 0)],
    ["failureDefault", at(failure, "text", 1)],
    ["failurePrefix", before(at(failure, "text", 1), "sent. ")],
    ["tryAgain", at(failure, "text", 3)],
    ["editTransaction", at(failure, "text", 4)],
    ["copyError", at(failure, "ariaLabels", 0)],
    ["toastConfirmed", outcome("accepted", "toast")],
    ["toastPreconfirmed", outcome("preconfirmed", "toast")],
    ["toastNotConfirmed", outcome("rejected", "toast")],
    ["rejectedMessage", outcome("rejected", "message")],
    ["revertedMessage", outcome("reverted", "message")],
    ["settingsThisAccount", at(screens, "deployRow", "eyebrow")],
    ["settingsDeployRow", at(screens, "deployRow", "label")],
    ["deployTitle", at(deploy, "undeployed", 0)],
    ["deployAccountRow", at(deploy, "undeployed", 2)],
    ["deployAddressRow", at(deploy, "undeployed", 4)],
    ["deployNetworkRow", at(deploy, "undeployed", 6)],
    ["deployButton", at(deploy, "undeployed", 9)],
    ["alreadyDeployed", at(deploy, "deployed", 8)],
    ["deployEstimating", at(deploy, "estimating")],
    ["deployEstimateFailed", at(deploy, "estimateFailed")],
    ["deploySubmitting", at(deploy, "submitting")],
    ["deploySubmittedTitle", at(deploy, "submittedTitle")],
    ["deployConfirmedTitle", at(deploy, "confirmedTitle")],
    ["deployConfirmedBody", at(deploy, "confirmedDescription")],
    ["maximumFeePrefix", at(deploy, "maximumFeePrefix")],
    ["poisonedRecipient", at(refusals, "poisonedRecipient")],
    ["selfTransfer", at(refusals, "selfTransfer")],
    ["sentTo", at(copy, "successSummary").replace("1.5 STRK", "").replace("0x3fa7…41a3", "")],
    ...["pending", "preconfirmed", "accepted", "rejected", "reverted"].map(
      (status) =>
        [
          `activity${status.charAt(0).toUpperCase()}${status.slice(1)}`,
          at(screens, "activityStatusLabels", status),
        ] as const,
    ),
    ["explorerLinkLabel", at(screens, "activityRow", "ariaLabels", 1).split(". ").at(-1) ?? ""],
    ["reviewedFeeExceeded", at(refusals, "reviewedFeeExceeded")],
    ["reviewedFeeRequired", at(refusals, "reviewedFeeRequired")],
    ["reviewedDeploymentFeeExceeded", at(refusals, "reviewedDeploymentFeeExceeded")],
    ["reviewedDeploymentFeeRequired", at(refusals, "reviewedDeploymentFeeRequired")],
    ...Object.keys(failures)
      .sort()
      .map(
        (code) =>
          [`failure${code.charAt(0).toUpperCase()}${code.slice(1)}`, at(failures, code)] as const,
      ),
  ];
};

// Keys read by position from rendered screens; a screen that gains a line shifts every later
// position, and the shifted text is still a valid string, so a drift would ship silently. These
// labels never repeat each other or quote the parity account's address or a "Show full" control.
const POSITIONAL_LABELS = [
  "fromRowLabel",
  "toRowLabel",
  "amountRowLabel",
  "fiatUnavailable",
  "transactionLabel",
  "viewActivity",
  "back",
  "tryAgain",
  "editTransaction",
  "deployTitle",
  "deployAccountRow",
  "deployAddressRow",
  "deployNetworkRow",
  "deployButton",
  "deployNote",
] as const;

const checkPositionalLabels = (entries: readonly (readonly [string, string])[]): void => {
  const values = POSITIONAL_LABELS.map((name) => {
    const found = entries.find(([key]) => key === name);
    if (!found) throw new Error(`send copy: no ${name}`);
    if (/0x[0-9a-f]|^Show full /i.test(found[1])) {
      throw new Error(`send copy: ${name} reads "${found[1]}", a shifted screen position`);
    }
    return found[1];
  });
  for (const name of ["showFullSender", "showFullRecipient"]) {
    const value = entries.find(([key]) => key === name)?.[1] ?? "";
    if (!/^Show full /.test(value)) {
      throw new Error(`send copy: ${name} reads "${value}", a shifted screen position`);
    }
  }
  const repeated = values.find((value, index) => values.indexOf(value) !== index);
  if (repeated !== undefined) {
    throw new Error(`send copy: "${repeated}" is read for two labels, a shifted screen position`);
  }
};

const quote = (text: string): string => JSON.stringify(text).replaceAll("$", "\\$");

/** The Swift and Kotlin copy tables for a fixture's copy section. */
export const renderSendCopy = (copy: Json): { readonly kotlin: string; readonly swift: string } => {
  const entries = sendCopyEntries(copy);
  checkPositionalLabels(entries);
  const header =
    "Generated by scripts/generate-mobile-transaction-vectors.ts from the extension's Send journey. Do not edit.";
  const swift = [
    `// ${header}`,
    "",
    "/// The extension's Send-journey strings (`extension-transactions-*.json`, `copy`). `{hash}` marks",
    "/// where a failure message names a transaction hash.",
    "enum SendCopy {",
    ...entries.map(([name, value]) => `    static let ${name} = ${JSON.stringify(value)}`),
    "}",
    "",
  ].join("\n");
  const kotlin = [
    `// ${header}`,
    "package org.bramble.wallet.send",
    "",
    "/** The extension's Send-journey strings (`extension-transactions-*.json`, `copy`). */",
    "object SendCopy {",
    ...entries.map(([name, value]) => `    const val ${name} = ${quote(value)}`),
    "}",
    "",
  ].join("\n");
  return { kotlin, swift };
};
