/**
 * Account choice on a connection card. Selecting a multisig presents that
 * account to the site. Selecting a single-signer account clears that presentation.
 */

export const connectAccountHandler =
  (deps: {
    readonly activeAccountId: () => string | null;
    readonly remember: (id: string | null) => void;
    readonly render: () => void;
    readonly showMultisig: () => void;
    readonly switchAccount: (id: string) => Promise<void>;
  }) =>
  (id: string, kind: "account" | "multisig"): void =>
    chooseConnectAccount({
      activeAccountId: deps.activeAccountId(),
      id,
      kind,
      remember: deps.remember,
      render: deps.render,
      showMultisig: deps.showMultisig,
      switchAccount: deps.switchAccount,
    });

const chooseConnectAccount = (input: {
  readonly activeAccountId: string | null;
  readonly id: string;
  readonly kind: "account" | "multisig";
  readonly remember: (id: string | null) => void;
  readonly render: () => void;
  readonly showMultisig: () => void;
  readonly switchAccount: (id: string) => Promise<void>;
}): void => {
  if (input.kind === "multisig") {
    input.remember(input.id);
    input.showMultisig();
    input.render();
    return;
  }
  input.remember(null);
  if (input.id !== input.activeAccountId) {
    void input.switchAccount(input.id).then(input.render);
    return;
  }
  input.render();
};

type MultisigSelection = { hydrated: boolean; id: string | null };

/**
 * Restores a stored multisig selection once, when it belongs to this network.
 * Returns the view the panel should show.
 */
export const adoptStoredMultisig = (
  selection: MultisigSelection,
  networkId: string,
  preferences: { readonly selectedMultisigId?: string } | null,
  activeView: string,
): { readonly id: string | null; readonly view: string } => {
  const stored = preferences?.selectedMultisigId;
  if (selection.hydrated || selection.id !== null || !stored?.startsWith(`${networkId}:`)) {
    return { id: selection.id, view: activeView };
  }
  return {
    id: stored,
    view: activeView === "home" ? "multisig-home" : activeView,
  };
};
