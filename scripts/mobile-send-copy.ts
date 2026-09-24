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
  const asset = section("send-asset-stage");
  const review = section("send-review-stage");
  const pending = section("send-pending");
  const success = section("send-success");
  const failure = section("send-failure");
  const fee = copy["reviewFee"] as Json;
  const failures = copy["failures"] as Json;
  const refusals = copy["refusals"] as Json;
  const working = copy["working"] as Json;
  return [
    ["titleRecipient", title("recipient")],
    ["titleAsset", title("asset")],
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
    ["reviewNote", at(copy, "mode", "reviewNote")],
    ["progressLabel", at(copy, "mode", "progressLabel")],
    ["sendingFrom", at(recipient, "text", 0)],
    ["sendingTo", at(recipient, "text", 3)],
    ["myAccounts", at(recipient, "text", 4)],
    ["addressBook", at(recipient, "text", 5)],
    ["addressBookEmpty", at(recipient, "text", 11)],
    ["noMatchingRecipient", at(recipient, "text", 12)],
    ["continueWithAddress", at(recipient, "text", 13)],
    ["recipientPlaceholder", at(recipient, "placeholders", 0)],
    ["recipientFieldLabel", at(recipient, "ariaLabels", 0)],
    ["invalidRecipient", at(refusals, "invalidRecipient")],
    ["accountsHeading", at(details, "text", 0)],
    ["fromLabel", at(details, "text", 1)],
    ["toLabel", at(details, "text", 5)],
    ["networkLabel", at(details, "text", 9)],
    ["assetLabel", at(details, "text", 12)],
    ["half", at(details, "text", 16)],
    ["max", at(details, "text", 17)],
    ["estimatedValueUnavailable", at(details, "text", 19)],
    ["amountPlaceholder", at(details, "placeholders", 0)],
    ["balanceUnavailable", at(screens, "balanceLines", 0, "line")],
    ["balancePrefix", before(at(screens, "balanceLines", 1, "line"), " ")],
    ["amountGate", at(screens, "amountGate")],
    ["amountInvalid", at(copy, "amountErrors", "invalid")],
    ["amountNotPositive", at(copy, "amountErrors", "notPositive")],
    ["amountTooManyDecimals", at(copy, "amountErrors", "tooManyDecimals")],
    ["searchTokens", at(asset, "placeholders", 0)],
    ["yourTokens", at(asset, "text", 1)],
    ["yourBalance", at(asset, "text", 2)],
    ["noMatchingToken", at(asset, "text", 9)],
    ["edit", at(review, "text", 1)],
    ["technicalDetails", at(review, "text", 2)],
    ["fiatUnavailable", at(screens, "review", "summary", 1)],
    ["recipientRowLabel", at(screens, "review", "summary", 2)],
    ["copyRecipient", at(screens, "review", "summaryLabels", 0)],
    ["whatWillHappen", at(screens, "review", "details", 0)],
    ["riskAndRecovery", at(screens, "review", "details", 2)],
    ["noWarnings", at(screens, "review", "details", 3)],
    ["deployNote", at(screens, "review", "detailsUndeployed", 3)],
    ["maximumCost", at(fee, "deployedKnown", 0)],
    ["feePrefix", before(at(fee, "deployedKnown", 1), ": ")],
    ["transactionFeePrefix", before(at(fee, "undeployedKnown", 1), ": ")],
    ["deploymentFeePrefix", before(at(fee, "undeployedKnown", 2), ": ")],
    ["feeFailed", at(fee, "deployedFailed", 1)],
    ["feesFailed", at(fee, "undeployedFailed", 1)],
    ["retryFee", at(fee, "deployedFailed", 2)],
    ["shortfall", at(screens, "review", "shortfall", 2)],
    ["feeUnavailableBlock", at(copy, "reviewBlocks", "feeUnavailable")],
    ["poisonedBlock", at(copy, "reviewBlocks", "poisoned")],
    ["workingAuthorizingTitle", at(working, "authorizing", "title")],
    ["workingAuthorizingCopy", at(working, "authorizing", "copy")],
    ["workingBroadcastingTitle", at(working, "broadcasting", "title")],
    ["workingBroadcastingCopy", at(working, "broadcasting", "copy")],
    ["workingConfirmingTitle", at(working, "confirming", "title")],
    ["workingConfirmingCopy", at(working, "confirming", "copy")],
    ["workingConfirmingLiveness", at(working, "confirming", "liveness")],
    ["taskReviewLocked", at(working, "authorizing", "labels", 0)],
    ["taskSign", at(working, "authorizing", "labels", 1)],
    ["taskBroadcast", at(working, "authorizing", "labels", 2)],
    ["taskConfirm", at(working, "authorizing", "labels", 3)],
    ["taskAuthorized", at(working, "confirming", "labels", 1)],
    ["taskBroadcastComplete", at(working, "confirming", "labels", 2)],
    ["keepAppOpen", at(copy, "mobileWording", "keepOpen")],
    ["successKicker", at(success, "text", 0)],
    ["successTitle", at(success, "text", 1)],
    ["viewActivity", at(success, "text", 2)],
    ["backToHome", at(success, "text", 3)],
    ["pendingKicker", at(pending, "text", 0)],
    ["pendingTitle", at(pending, "text", 1)],
    ["pendingBody", at(pending, "text", 2)],
    ["checkConfirmation", at(pending, "text", 3)],
    ["failureKicker", at(failure, "text", 0)],
    ["failureTitle", at(failure, "text", 1)],
    ["failureDefault", at(failure, "text", 2)],
    ["failurePrefix", before(at(failure, "text", 2), "sent. ")],
    ["tryAgain", at(failure, "text", 3)],
    ["editTransaction", at(failure, "text", 4)],
    ["toastConfirmed", outcome("accepted", "toast")],
    ["toastPreconfirmed", outcome("preconfirmed", "toast")],
    ["toastNotConfirmed", outcome("rejected", "toast")],
    ["rejectedMessage", outcome("rejected", "message")],
    ["revertedMessage", outcome("reverted", "message")],
    ["deployChip", at(screens, "deployNotice", "deploy", "label")],
    ["deployChipTitle", at(screens, "deployNotice", "deploy", "title")],
    ["fundChip", at(screens, "deployNotice", "fund", "label")],
    ["fundChipTitle", at(screens, "deployNotice", "fund", "title")],
    ["deployTitle", at(screens, "deployAccount", "undeployed", 0)],
    ["deployOutcome", at(screens, "deployAccount", "undeployed", 4)],
    ["deployAccountRow", at(screens, "deployAccount", "undeployed", 5)],
    ["deployAddressRow", at(screens, "deployAccount", "undeployed", 7)],
    ["deployContractRow", at(screens, "deployAccount", "undeployed", 9)],
    ["deployContractValue", at(screens, "deployAccount", "undeployed", 10)],
    ["deployNetworkRow", at(screens, "deployAccount", "undeployed", 11)],
    ["deployRisk", at(screens, "deployAccount", "undeployed", 14)],
    ["reviewDeployment", at(screens, "deployAccount", "undeployed", 15)],
    ["alreadyDeployed", at(screens, "deployAccount", "deployed", 15)],
    ["deploySuccessKicker", at(screens, "deployAccount", "undeployed", 16)],
    ["deploySuccessTitle", at(screens, "deployAccount", "undeployed", 17)],
    ["deploySuccessBody", at(screens, "deployAccount", "undeployed", 18)],
    ["confirmDeploymentPrefix", at(screens, "deployAccount", "confirmPrefix")],
    ["maximumFeePrefix", at(screens, "deployAccount", "maximumFeePrefix")],
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

const quote = (text: string): string => JSON.stringify(text).replaceAll("$", "\\$");

/** The Swift and Kotlin copy tables for a fixture's copy section. */
export const renderSendCopy = (copy: Json): { readonly kotlin: string; readonly swift: string } => {
  const entries = sendCopyEntries(copy);
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
