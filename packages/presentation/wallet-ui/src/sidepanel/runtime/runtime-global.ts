/**
 * Browser-global types used only at the wallet presentation composition edge.
 */
import type { OnboardingCompletionBrowser } from "../journeys/onboarding/onboarding-surface";
import type { RuntimeApi } from "./runtime";

/**
 * Exact-origin host-permission check and prompt: a custom HTTP service is
 * requested when the user saves it, the QSB coordinator when
 * the user first needs it. `request` must run inside a user gesture.
 */
export type HostPermissionApi = {
  readonly contains: (input: { readonly origins: string[] }) => Promise<boolean>;
  readonly request: (input: { readonly origins: string[] }) => Promise<boolean>;
};

/**
 * Browser capability injected by the extension composition root.
 */
export type WalletUiBrowser = OnboardingCompletionBrowser & {
  readonly permissions?: HostPermissionApi;
  readonly runtime?: RuntimeApi;
};
