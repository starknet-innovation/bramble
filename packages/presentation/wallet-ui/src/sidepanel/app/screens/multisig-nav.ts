/**
 * Dashboard and multisig navigation that presents an account to a site.
 * The panel changes view only after that choice is stored.
 */

import type { SendIntent } from "../../journeys/send/send-model";
import type { WalletView } from "./views";

export { persistChoice } from "./connect-account";

type Remember = (id: string | null) => Promise<boolean>;

/**
 * Multisig screen callbacks. Each waits for the presented account to be
 * stored, and leaves the panel where it was when that write fails.
 */
export const multisigNav = (deps: {
  readonly currentId: () => string | null;
  readonly navigate: (view: WalletView) => void;
  readonly remember: Remember;
  readonly setActiveAccount: (id: string) => Promise<void>;
  readonly setIntent: (intent: SendIntent) => void;
  readonly setIntentId: (id: string | null) => void;
}) => ({
  openDetail: (id: string, destination: "multisig-detail" | "multisig-home" = "multisig-home") => {
    void deps.remember(id).then((saved) => {
      if (!saved) return;
      deps.setIntentId(null);
      deps.navigate(destination);
    });
  },
  openFunding: async (intent: SendIntent) => {
    await deps.setActiveAccount(intent.accountId);
    const saved = await deps.remember(intent.completeMultisigId ?? deps.currentId());
    if (!saved) return;
    deps.setIntent(intent);
    deps.navigate("send");
  },
  openIntent: (accountId: string, intentId: string) => {
    void deps.remember(accountId).then((saved) => {
      if (!saved) return;
      deps.setIntentId(intentId);
      deps.navigate("multisig-detail");
    });
  },
  openList: () => {
    void deps.remember(null).then((saved) => {
      if (!saved) return;
      deps.navigate("multisigs");
    });
  },
});
