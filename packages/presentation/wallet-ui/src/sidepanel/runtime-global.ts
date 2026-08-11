/**
 * Browser-global types used only at the wallet presentation composition edge.
 */
import type { OnboardingCompletionBrowser } from "./onboarding-surface";
import type { RuntimeApi } from "./runtime";

/**
 * Browser capability injected by the extension composition root.
 */
export type WalletUiBrowser = OnboardingCompletionBrowser & { readonly runtime?: RuntimeApi };
