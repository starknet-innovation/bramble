/**
 * The extension's multisig intent-card copy (`review.multisig.card.*`, `review.multisig.technical.*`
 * and the signers-changed note in `review-steps-multisig.ts`), rendered for the mobile intent card
 * so neither app restates a signing sentence. These are approval/review text pinned by
 * `tests/i18n/review-pins.ts`; `{signed}` and `{threshold}` are filled in by the apps exactly as
 * the side panel's `t()` fills them.
 *
 * Not here, by design: the card's call summaries and risk lines, which come from the Rust core
 * (`MultisigIntentReview`) and are shown verbatim.
 */
// Not a package export: the English catalog, read here only to pin the mobile copy to it.
import { reviewStepsMultisigMessages } from "../../packages/presentation/wallet-ui/src/i18n/messages/review-steps-multisig";
import { HEADER, sorted } from "./shared";

/** Repository-relative path of the iOS multisig card copy table. */
export const MULTISIG_COPY_SWIFT_PATH =
  "mobile/ios/Bramble/Screens/Multisig/MultisigCopy.generated.swift";
/** Repository-relative path of the Android multisig card copy table. */
export const MULTISIG_COPY_KOTLIN_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/coordination/MultisigCopy.generated.kt";

const PREFIXES = ["review.multisig.card.", "review.multisig.technical."] as const;
const SINGLES = ["review.multisig.note.signersChanged"] as const;

// `review.multisig.card.signersChanged` → `cardSignersChanged`.
const camel = (key: string): string =>
  key
    .replace(/^review\.multisig\./, "")
    .split(".")
    .map((part, index) => (index === 0 ? part : `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`))
    .join("");

/** The intent card's English strings, keyed by camelCase name. */
export const multisigCopy = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(reviewStepsMultisigMessages.en)
      .filter(
        ([key]) =>
          PREFIXES.some((prefix) => key.startsWith(prefix)) ||
          (SINGLES as readonly string[]).includes(key),
      )
      .map(([key, value]) => [camel(key), value]),
  );

const quoted = (value: string): string => JSON.stringify(value);

/** `MultisigCopy.generated.swift`. */
export const renderSwiftMultisigCopy = (): string =>
  [
    `// ${HEADER}`,
    "",
    "/// The extension's multisig intent-card copy (`review-steps-multisig.ts`); placeholders are",
    "/// filled by the app.",
    "enum MultisigCopy {",
    ...sorted(multisigCopy()).map(([key, value]) => `    static let ${key} = ${quoted(value)}`),
    "}",
    "",
  ].join("\n");

/** `MultisigCopy.generated.kt`. */
export const renderKotlinMultisigCopy = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.coordination",
    "",
    "/** The extension's multisig intent-card copy (`review-steps-multisig.ts`); placeholders are filled by the app. */",
    "object MultisigCopy {",
    ...sorted(multisigCopy()).map(
      ([key, value]) => `    const val ${key} = ${quoted(value).replaceAll("$", "\\$")}`,
    ),
    "}",
    "",
  ].join("\n");
