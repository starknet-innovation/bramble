/**
 * Dashboard and multisig navigation that presents an account to a site.
 * The panel changes view only after that choice is stored.
 */

import type { SendIntent } from "../../journeys/send/send-model";
import { persistChoice } from "./connect-account";
import type { WalletView } from "./views";

type Remember = (id: string | null) => Promise<boolean>;

/**
 * The panel's presented-multisig selection. `adopt` sets what the stored
 * preference says; `show` marks it hydrated and reports the id; `remember`
 * stores the choice first and shows it only once the write succeeds,
 * notifying (and keeping the old choice) when it fails.
 */
export const multisigSelection = (deps: {
  readonly notify: () => void;
  readonly onShow: (id: string | null) => void;
  readonly write: (id: string | null) => Promise<void>;
}) => {
  const selection = { hydrated: false, id: null as string | null };
  const adopt = (hydrated: boolean, id: string | null): void => {
    selection.hydrated = hydrated;
    selection.id = id;
    deps.onShow(id);
  };
  const show = (id: string | null): void => adopt(true, id);
  return { adopt, remember: persistChoice({ ...deps, assign: show }), selection, show };
};

/** Runs `next` only after the presented account `id` is stored. */
export const whenSaved = (remember: Remember, id: string | null, next: () => void): void => {
  void remember(id).then((saved) => {
    if (saved) next();
  });
};

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
