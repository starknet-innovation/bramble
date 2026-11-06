/**
 * Validation and write shape for display preferences (`setDisplay`). Split
 * from preferences.ts to keep the store within the size budget.
 */
import {
  isApprovalSurfacePreference,
  isDisplayCurrency,
  isThemeChoice,
} from "@bramble/wallet-model/preferences";
import type { WalletPreferencesStore } from "./preferences-types";

/** The on/off display preferences; each is written only when the input names it. */
const DISPLAY_FLAGS = [
  "collectiblesPreview",
  "productAnalytics",
  "reliabilityDiagnostics",
] as const;

/** Whether a `setDisplay` input carries only known values. */
export const isValidDisplayInput = (
  input: Parameters<WalletPreferencesStore["setDisplay"]>[0],
): boolean => {
  if (input.approvalSurface !== undefined && !isApprovalSurfacePreference(input.approvalSurface)) {
    return false;
  }
  if (input.displayCurrency !== undefined && !isDisplayCurrency(input.displayCurrency)) {
    return false;
  }
  if (DISPLAY_FLAGS.some((flag) => input[flag] !== undefined && typeof input[flag] !== "boolean")) {
    return false;
  }
  return input.theme === undefined || isThemeChoice(input.theme);
};

/** The on/off flags a `setDisplay` input names, ready to spread into the record. */
export const displayFlags = (
  input: Parameters<WalletPreferencesStore["setDisplay"]>[0],
): Partial<Record<(typeof DISPLAY_FLAGS)[number], boolean>> =>
  Object.fromEntries(
    DISPLAY_FLAGS.flatMap((flag) => (input[flag] === undefined ? [] : [[flag, input[flag]]])),
  );
