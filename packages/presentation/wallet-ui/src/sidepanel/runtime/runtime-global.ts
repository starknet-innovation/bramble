/**
 * Browser-global types used only at the wallet presentation composition edge.
 */
import type { OnboardingCompletionBrowser } from "../journeys/onboarding/onboarding-surface";
import type { RuntimeApi } from "./runtime";

/** Exact-origin permission prompt used when a user saves a custom HTTP service. */
export type HostPermissionApi = {
  readonly request: (input: { readonly origins: string[] }) => Promise<boolean>;
};

/**
 * Browser capability injected by the extension composition root.
 */
export type WalletUiBrowser = OnboardingCompletionBrowser & {
  readonly permissions?: HostPermissionApi;
  readonly runtime?: RuntimeApi;
};
