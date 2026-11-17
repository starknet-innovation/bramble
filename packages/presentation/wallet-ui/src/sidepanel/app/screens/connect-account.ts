/**
 * Account choice on a connection card. Selecting a multisig presents that
 * account to the site. Selecting a single-signer account clears that presentation.
 */

type ConnectChoiceDeps = {
  readonly activeAccountId: () => string | null;
  /** Resolves true only after the presented account has been stored. */
  readonly remember: (id: string | null) => Promise<boolean>;
  readonly render: () => void;
  readonly showMultisig: () => void;
  readonly switchAccount: (id: string) => Promise<void>;
};

/**
 * Writes the presented account, then reports whether the panel may show it.
 * A failed write leaves the previous selection in place.
 */
export const persistChoice =
  (deps: {
    readonly assign: (id: string | null) => void;
    readonly notify: () => void;
    readonly write: (id: string | null) => Promise<void>;
  }) =>
  async (id: string | null): Promise<boolean> => {
    try {
      await deps.write(id);
    } catch {
      deps.notify();
      return false;
    }
    deps.assign(id);
    return true;
  };

/** Presents the chosen account, then repaints only after that choice is stored. */
export const connectAccountHandler =
  (deps: ConnectChoiceDeps) =>
  (id: string, kind: "account" | "multisig"): void =>
    chooseConnectAccount({ ...deps, id, kind });

/**
 * Connection-card handler. The choice is painted only after `write` resolves,
 * so Connect cannot approve an account the background has not stored.
 */
export const bindConnectChoice = (deps: {
  readonly accountId: () => string | null;
  readonly apply: (id: string | null) => void;
  readonly notify: () => void;
  readonly render: () => void;
  readonly showMultisig: () => void;
  readonly switchAccount: (id: string) => Promise<void>;
  readonly write: (id: string | null) => Promise<void>;
}): ReturnType<typeof connectAccountHandler> =>
  connectAccountHandler({
    activeAccountId: deps.accountId,
    remember: persistChoice({ assign: deps.apply, notify: deps.notify, write: deps.write }),
    render: deps.render,
    showMultisig: deps.showMultisig,
    switchAccount: deps.switchAccount,
  });

const finishConnectChoice = (
  input: ConnectChoiceDeps & { readonly id: string; readonly kind: "account" | "multisig" },
): void => {
  if (input.kind === "multisig") {
    input.showMultisig();
    input.render();
    return;
  }
  if (input.id !== input.activeAccountId()) {
    void input.switchAccount(input.id).then(input.render);
    return;
  }
  input.render();
};

const chooseConnectAccount = (
  input: ConnectChoiceDeps & { readonly id: string; readonly kind: "account" | "multisig" },
): void => {
  const presented = input.kind === "multisig" ? input.id : null;
  void input.remember(presented).then((saved) => {
    if (saved) finishConnectChoice(input);
  });
};

type MultisigSelection = { hydrated: boolean; id: string | null };

/**
 * Restores a stored multisig selection once, when it belongs to this network.
 * Returns the view the panel should show.
 */
export const adoptStoredMultisig = (
  selection: MultisigSelection,
  networkId: string,
  preferences: { readonly selectedMultisigId?: string } | null | undefined,
  activeView: string,
): { readonly hydrated: boolean; readonly id: string | null; readonly view: string } => {
  if (preferences === undefined) {
    return { hydrated: selection.hydrated, id: selection.id, view: activeView };
  }
  const stored = preferences?.selectedMultisigId;
  if (selection.hydrated || selection.id !== null || !stored?.startsWith(`${networkId}:`)) {
    return { hydrated: true, id: selection.id, view: activeView };
  }
  return {
    hydrated: true,
    id: stored,
    view: activeView === "home" ? "multisig-home" : activeView,
  };
};
