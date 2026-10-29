/**
 * The mobile vault-security copy and policy, rendered for Swift, Kotlin and the Rust core.
 *
 * Strings the extension already has are imported from its TypeScript. The rest are mobile-only
 * (biometric unlock and the Security screen have no extension counterpart) and are written here
 * once, so neither native app restates them. `{biometry}`, `{time}` and `{minutes}` are filled
 * in by the apps (`Face ID` / `Touch ID` / `fingerprint`, a `m:ss` countdown, the idle minutes).
 */
import { KDF_ITERATIONS } from "@bramble/vault/encrypted-store";
import { MIN_VAULT_PASSPHRASE_LENGTH } from "@bramble/wallet-model/passphrase";
import { INCORRECT_PASSPHRASE_MESSAGE } from "../../apps/extension/src/background/routing/unlock-errors";
import { DEFAULT_TTL_MS } from "../../apps/extension/src/background/runtime/session";
import { HEADER, sorted } from "./shared";

/** The Face ID usage string iOS shows; `project.yml` must carry it verbatim (checked). */
export const FACE_ID_USAGE =
  "Bramble uses Face ID to unlock your wallet instead of typing your passphrase.";

/** Every security string the mobile apps show, keyed by camelCase name. */
const SECURITY_COPY: Readonly<Record<string, string>> = {
  autoLockBackground: "When Bramble leaves the screen",
  autoLockEyebrow: "Auto-lock",
  autoLockIdle: "After {minutes} minutes idle",
  biometricEnable: "Turn on {biometry}",
  biometricEyebrow: "Biometric unlock",
  biometricInvalidated:
    "{biometry} changed on this device. Enter your passphrase, then turn it on again in Security.",
  biometricOnStatus:
    "{biometry} will unlock this wallet. Your passphrase still works and is still needed to reveal secrets.",
  biometricPromptReason: "Unlock your wallet",
  biometricUnavailable: "{biometry} is not set up on this device.",
  clipboardCleared: "Clipboard cleared",
  faceIdUsage: FACE_ID_USAGE,
  incorrectPassphrase: INCORRECT_PASSPHRASE_MESSAGE,
  keyStorageSecureHardware: "Key storage: Secure hardware",
  keyStorageStrongBox: "Key storage: StrongBox",
  screenshotWarning:
    "Screenshot taken. If it shows your recovery phrase, delete it — other apps and your photo library can read screenshots.",
  securityRowOff: "Passphrase only",
  securityRowOn: "{biometry} on",
  securitySubtitle: "How this device opens your wallet",
  securityTitle: "Unlock & auto-lock",
  throttled: "Too many attempts. Try again in {time}.",
  unlockWithBiometry: "Unlock with {biometry}",
};

/** Numeric policy both wallets share. The Rust core asserts its constants equal these. */
export const SECURITY_POLICY = {
  idleLockMs: DEFAULT_TTL_MS,
  kdfIterations: KDF_ITERATIONS,
  minPassphraseLength: MIN_VAULT_PASSPHRASE_LENGTH,
} as const;

const quoted = (value: string): string => JSON.stringify(value);

/** `mobile/core/generated/policy.json`. */
export const renderPolicyJson = (): string =>
  `${JSON.stringify({ generatedBy: HEADER, ...SECURITY_POLICY }, null, 2)}\n`;

/** `BrambleCopy.generated.swift`. */
export const renderSwiftCopy = (): string =>
  [
    `// ${HEADER}`,
    "",
    "/// Vault-security copy shared with the extension and the Android app.",
    "enum BrambleCopy {",
    ...sorted(SECURITY_COPY).map(([key, value]) => `    static let ${key} = ${quoted(value)}`),
    `    static let idleLockMs: UInt64 = ${SECURITY_POLICY.idleLockMs}`,
    "}",
    "",
  ].join("\n");

/** `BrambleCopy.generated.kt`. */
export const renderKotlinCopy = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.design",
    "",
    "/** Vault-security copy shared with the extension and the iOS app. */",
    "object BrambleCopy {",
    ...sorted(SECURITY_COPY).map(
      ([key, value]) => `    const val ${key} = ${quoted(value).replaceAll("$", "\\$")}`,
    ),
    `    const val idleLockMs: Long = ${SECURITY_POLICY.idleLockMs}L`,
    "}",
    "",
  ].join("\n");
