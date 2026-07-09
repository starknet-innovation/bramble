/**
 * Multisig screen bindings: watch/remove/refresh multisigs, submit and track
 * proposals, confirm/revoke/execute them, and deploy or declare through the
 * background message client. Pure templates live in multisig-views.ts.
 */
import type { WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { MultisigClient } from "./multisig-runtime";
import type { SidepanelWallet } from "./runtime";

/**
 * Dependencies the multisig bindings close over. `openDetail` navigates to
 * the detail screen for a watched multisig id; `openList` returns to the
 * multisig list (after a remove).
 */
export type MultisigUiDeps = {
  readonly app: Element | null;
  readonly multisig: MultisigClient;
  readonly openDetail: (id: string) => void;
  readonly openList: () => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly selectedMultisigId: () => string | null;
  readonly wallet: SidepanelWallet;
};

const rerender = async (deps: MultisigUiDeps): Promise<void> => {
  await deps.render(await deps.wallet.loadStatus());
};

const setResult = (deps: MultisigUiDeps, id: string, message: string): void => {
  const result = deps.app?.querySelector<HTMLElement>(`#${id}`);
  if (result) {
    result.textContent = message;
  }
};

const runAction = (
  deps: MultisigUiDeps,
  button: HTMLButtonElement | null | undefined,
  resultId: string,
  pendingMessage: string,
  action: () => Promise<string>,
): void => {
  buttonBusy(button, true);
  setResult(deps, resultId, pendingMessage);
  void action().then(
    async (message) => {
      showToast(message, "success");
      await rerender(deps);
    },
    (error: unknown) => {
      const failed = errorMessage(error, "Request failed");
      showToast(failed, "error");
      setResult(deps, resultId, failed);
      buttonBusy(button, false);
    },
  );
};

const bindAddForm = (deps: MultisigUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-add-form");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    runAction(deps, submitButton, "multisig-add-result", "Checking on-chain…", async () => {
      await deps.multisig.addMultisig(
        String(data.get("address") ?? "").trim(),
        String(data.get("name") ?? "").trim(),
      );
      return "Multisig watched";
    });
  });
};

const bindListActions = (deps: MultisigUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-multisig-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.multisigOpen;
      if (id) {
        deps.openDetail(id);
      }
    });
  });

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-multisig-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.multisigRemove;
      if (!id) {
        return;
      }
      buttonBusy(button, true);
      void deps.multisig.removeMultisig(id).then(
        async () => {
          showToast("Multisig removed", "success");
          deps.openList();
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Remove failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });

  const refresh = deps.app?.querySelector<HTMLButtonElement>("#multisig-refresh");
  refresh?.addEventListener("click", () => {
    const id = refresh.dataset.multisigId;
    if (!id) {
      return;
    }
    runAction(deps, refresh, "multisig-detail-result", "Refreshing from chain…", async () => {
      await deps.multisig.refreshMultisig(id);
      return "Refreshed from chain";
    });
  });
};

const bindProposalActions = (deps: MultisigUiDeps): void => {
  const syncAcknowledgment = (row: Element, checked: boolean): void => {
    row.querySelectorAll<HTMLButtonElement>("[data-ms-requires-ack]").forEach((button) => {
      const target = button;
      target.disabled = !checked;
    });
  };

  deps.app?.querySelectorAll<HTMLInputElement>("[data-ms-ack]").forEach((checkbox) => {
    const row = checkbox.closest(".allowance-row");
    if (!row) {
      return;
    }
    checkbox.addEventListener("change", () => {
      syncAcknowledgment(row, checkbox.checked);
    });
  });

  const actions: readonly {
    readonly attribute: string;
    readonly key: "msConfirm" | "msExecute" | "msRevoke";
    readonly run: (proposalId: string, untrackedVerified?: boolean) => Promise<string>;
    readonly success: string;
  }[] = [
    {
      attribute: "[data-ms-confirm]",
      key: "msConfirm",
      run: (id, untrackedVerified) => deps.multisig.confirmProposal(id, untrackedVerified),
      success: "Confirmation submitted",
    },
    {
      attribute: "[data-ms-revoke]",
      key: "msRevoke",
      run: (id, untrackedVerified) => deps.multisig.revokeConfirmation(id, untrackedVerified),
      success: "Revocation submitted",
    },
    {
      attribute: "[data-ms-execute]",
      key: "msExecute",
      run: (id) => deps.multisig.executeProposal(id),
      success: "Execution submitted",
    },
  ];
  for (const action of actions) {
    deps.app?.querySelectorAll<HTMLButtonElement>(action.attribute).forEach((button) => {
      button.addEventListener("click", () => {
        const proposalId = button.dataset[action.key];
        if (!proposalId) {
          return;
        }
        const row = button.closest(".allowance-row");
        const requiresAck = button.dataset.msRequiresAck === "true";
        const ack = requiresAck
          ? row?.querySelector<HTMLInputElement>("[data-ms-ack]")?.checked
          : undefined;
        if (requiresAck && !ack) {
          showToast("Verify the proposal and check the acknowledgment first", "error");
          return;
        }
        runAction(deps, button, "multisig-proposal-result", "Submitting…", async () => {
          await action.run(proposalId, ack ? true : undefined);
          return action.success;
        });
      });
    });
  }
};

const bindTrackForm = (deps: MultisigUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-track-form");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const multisigId = deps.selectedMultisigId();
    if (!multisigId) {
      return;
    }
    const data = new FormData(form);
    runAction(deps, submitButton, "multisig-track-result", "Checking on-chain…", async () => {
      await deps.multisig.trackProposal(
        multisigId,
        String(data.get("txId") ?? "").trim(),
        String(data.get("summary") ?? "").trim(),
      );
      return "Proposal tracked";
    });
  });
};

// Splits a felts textarea on any whitespace or commas, dropping empties.
const parseFelts = (raw: string): readonly string[] =>
  raw
    .split(/[\s,]+/)
    .map((felt) => felt.trim())
    .filter((felt) => felt.length > 0);

const bindProposeForm = (deps: MultisigUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-propose-form");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const multisigId = deps.selectedMultisigId();
    if (!multisigId) {
      return;
    }
    const data = new FormData(form);
    runAction(deps, submitButton, "multisig-propose-result", "Submitting proposal…", async () => {
      const transactionHash = await deps.multisig.proposeTransaction({
        calldata: parseFelts(String(data.get("calldata") ?? "")),
        entrypoint: String(data.get("entrypoint") ?? "").trim(),
        multisigId,
        salt: String(data.get("salt") ?? "").trim(),
        summary: String(data.get("summary") ?? "").trim(),
        to: String(data.get("to") ?? "").trim(),
      });
      deps.openDetail(multisigId);
      return `Proposal submitted: ${transactionHash}`;
    });
  });
};

const bindDeployScreen = (deps: MultisigUiDeps): void => {
  const declare = deps.app?.querySelector<HTMLButtonElement>("#multisig-declare");
  declare?.addEventListener("click", () => {
    runAction(deps, declare, "multisig-declare-result", "Submitting declare…", async () => {
      const transactionHash = await deps.multisig.declareClass();
      return `Declare submitted: ${transactionHash}`;
    });
  });

  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-deploy-form");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const quorum = Number(String(data.get("quorum") ?? "").trim());
    runAction(deps, submitButton, "multisig-deploy-result", "Submitting deployment…", async () => {
      const result = await deps.multisig.deployMultisig(
        parseFelts(String(data.get("signers") ?? "")),
        quorum,
        String(data.get("salt") ?? "").trim(),
        String(data.get("name") ?? "").trim(),
      );
      deps.openList();
      return `Deployment submitted at ${result.address} — watch it once the transaction finalizes`;
    });
  });
};

/**
 * Binds every multisig screen: list, detail, propose, and deploy.
 */
export const bindMultisigs = (deps: MultisigUiDeps): void => {
  bindAddForm(deps);
  bindListActions(deps);
  bindProposalActions(deps);
  bindTrackForm(deps);
  bindProposeForm(deps);
  bindDeployScreen(deps);
};
