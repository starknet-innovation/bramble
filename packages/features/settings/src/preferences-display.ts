/**
 * Validation and write shape for display preferences (`setDisplay`). Split
 * from preferences.ts to keep the store within the size budget.
 */
import { isAccountId } from "@bramble/wallet-model/accounts";
import {
  isApprovalSurfacePreference,
  isDisplayCurrency,
  isLanguagePreference,
  isThemeChoice,
  MAX_READY_KEY_NOTICE_DISMISSALS,
} from "@bramble/wallet-model/preferences";
import type { WalletPreferences, WalletPreferencesStore } from "./preferences-types";

/** The on/off display preferences; each is written only when the input names it. */
const DISPLAY_FLAGS = [
  "collectiblesPreview",
  "productAnalytics",
  "reliabilityDiagnostics",
  "vipNotice",
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
  if (input.language !== undefined && !isLanguagePreference(input.language)) {
    return false;
  }
  if (DISPLAY_FLAGS.some((flag) => input[flag] !== undefined && typeof input[flag] !== "boolean")) {
    return false;
  }
  if (input.readyKeyNoticeDismissed !== undefined && !isAccountId(input.readyKeyNoticeDismissed)) {
    return false;
  }
  return input.theme === undefined || isThemeChoice(input.theme);
};

/**
 * The dismissed Ready key notice list after a `setDisplay` input, ready to
 * spread into the record: the named account moves to the newest end, and past
 * {@link MAX_READY_KEY_NOTICE_DISMISSALS} the oldest drops. Empty when the
 * input names no account. Expects an input already checked by
 * {@link isValidDisplayInput}.
 */
export const readyKeyNoticeDismissal = (
  preferences: WalletPreferences,
  input: Parameters<WalletPreferencesStore["setDisplay"]>[0],
): Pick<WalletPreferences, "readyKeyNoticeDismissedIds"> => {
  const accountId = input.readyKeyNoticeDismissed;
  if (accountId === undefined) return {};
  const kept = (preferences.readyKeyNoticeDismissedIds ?? []).filter((id) => id !== accountId);
  return {
    readyKeyNoticeDismissedIds: [...kept, accountId].slice(-MAX_READY_KEY_NOTICE_DISMISSALS),
  };
};

/** The on/off flags a `setDisplay` input names, ready to spread into the record. */
export const displayFlags = (
  input: Parameters<WalletPreferencesStore["setDisplay"]>[0],
): Partial<Record<(typeof DISPLAY_FLAGS)[number], boolean>> =>
  Object.fromEntries(
    DISPLAY_FLAGS.flatMap((flag) => (input[flag] === undefined ? [] : [[flag, input[flag]]])),
  );

/**
 * Whether NFTs are shown (the Home NFTs tab, the gallery, NFT discovery, and
 * site NFT watch cards that can be approved). On by default: only an explicit
 * `collectiblesPreview: false`, the user turning NFTs off, hides them.
 * Unknown preferences (null, not loaded yet) fail closed to off, so nothing is
 * read or sent before the user's choice is known.
 */
export const nftsShown = (
  preferences: { readonly collectiblesPreview?: boolean } | null | undefined,
): boolean =>
  preferences !== null && preferences !== undefined && preferences.collectiblesPreview !== false;
