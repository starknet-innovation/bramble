/**
 * Multisig screen bindings: watch/remove/refresh multisigs, submit and track
 * proposals, confirm/revoke/execute them, and deploy or declare through the
 * background message client. Pure templates live in multisig-views.ts.
 */
import { normalizeFeltInput } from "../starknet/networks";
import { buttonBusy, errorMessage, showToast } from "./dom";
import { bindMultisigConfirmation } from "./multisig-confirmation-ui";
import { bindMultisigDeploy } from "./multisig-deploy-ui";
import { parseMultisigReviewPackage } from "./multisig-model";
import { bindMultisigProposalForm } from "./multisig-proposal-ui";
import { bindMultisigReviewTools } from "./multisig-review-ui";
import { isMultisigSyncFailure, multisigSyncActionMessage } from "./multisig-sync";
import type { MultisigUiDeps } from "./multisig-ui-deps";

/**
 * Re-exports the multisig binder contract for existing callers.
 */
export type { MultisigUiDeps } from "./multisig-ui-deps";

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

const WATCH_TIMEOUT_MS = 15_000;

const boundedWatch = async (watch: Promise<void>): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      watch,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Multisig verification took too long. Check the RPC endpoint and retry."),
            ),
          WATCH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
};

const startWatchProgress = (deps: MultisigUiDeps): (() => void) => {
  const resultId = "multisig-add-result";
  const timers = [
    setTimeout(() => setResult(deps, resultId, "Reading signer and quorum rules…"), 700),
    setTimeout(() => setResult(deps, resultId, "Verifying this account is a signer…"), 2_000),
    setTimeout(
      () => setResult(deps, resultId, "The RPC is slower than expected; failover is automatic…"),
      4_000,
    ),
    setTimeout(() => setResult(deps, resultId, "Trying the fallback RPC endpoint…"), 10_000),
  ];
  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  };
};

const bindAddForm = (deps: MultisigUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-add-form");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    runAction(deps, submitButton, "multisig-add-result", "Contacting Starknet…", async () => {
      const stopProgress = startWatchProgress(deps);
      try {
        await boundedWatch(
          deps.multisig.addMultisig(
            normalizeFeltInput(String(data.get("address") ?? "")),
            String(data.get("name") ?? "").trim(),
          ),
        );
        return "Multisig verified and added to Accounts";
      } finally {
        stopProgress();
      }
    });
  });
};

const bindListActions = (deps: MultisigUiDeps): void => {
  deps.app
    ?.querySelector<HTMLButtonElement>("#multisig-list-retry")
    ?.addEventListener("click", () => {
      void rerender(deps);
    });
  deps.app
    ?.querySelector<HTMLButtonElement>("[data-multisig-portfolio-retry]")
    ?.addEventListener("click", () => {
      void rerender(deps);
    });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-multisig-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["multisigOpen"];
      if (id) {
        deps.openDetail(id);
      }
    });
  });

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-multisig-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["multisigRemove"];
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
    const id = refresh.dataset["multisigId"];
    if (!id) {
      return;
    }
    runAction(deps, refresh, "multisig-detail-result", "Refreshing from chain…", async () => {
      const state = await deps.multisig.refreshMultisig(id);
      const message = multisigSyncActionMessage(state);
      if (isMultisigSyncFailure(state)) {
        throw new Error(message);
      }
      return message;
    });
  });
};

type MultisigHomeTab = "assets" | "collectibles" | "proposals";
let retainedMultisigTab: { readonly id: string; readonly tab: MultisigHomeTab } | null = null;

const isMultisigHomeTab = (value: string | undefined): value is MultisigHomeTab =>
  value === "assets" || value === "collectibles" || value === "proposals";

const bindPortfolioTabs = (deps: MultisigUiDeps): void => {
  const multisigId = deps.selectedMultisigId();
  const apply = (selected: MultisigHomeTab): void => {
    deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-home-tab]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset["msHomeTab"] === selected));
    });
    deps.app?.querySelectorAll<HTMLElement>("[data-ms-home-panel]").forEach((panel) => {
      const target = panel;
      target.hidden = target.dataset["msHomePanel"] !== selected;
    });
  };
  if (!multisigId) {
    retainedMultisigTab = null;
    return;
  }
  apply(retainedMultisigTab?.id === multisigId ? retainedMultisigTab.tab : "assets");
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-home-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = button.dataset["msHomeTab"];
      if (!isMultisigHomeTab(selected)) return;
      retainedMultisigTab = { id: multisigId, tab: selected };
      apply(selected);
    });
  });
};

const bindProposalActions = (deps: MultisigUiDeps): void => {
  const syncAcknowledgment = (row: Element, checked: boolean): void => {
    row.querySelectorAll<HTMLButtonElement>("[data-ms-requires-ack]").forEach((button) => {
      const target = button;
      target.disabled =
        target.hasAttribute("data-busy") ||
        target.dataset["msActionAllowed"] !== "true" ||
        !checked;
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
    readonly key: "msExecute" | "msRevoke";
    readonly run: (
      proposalId: string,
      signerAccountId: string,
      untrackedVerified?: boolean,
    ) => Promise<string>;
    readonly success: string;
  }[] = [
    {
      attribute: "[data-ms-revoke]",
      key: "msRevoke",
      run: (id, signerAccountId, untrackedVerified) =>
        deps.multisig.revokeConfirmation(id, signerAccountId, untrackedVerified),
      success: "Revocation submitted",
    },
    {
      attribute: "[data-ms-execute]",
      key: "msExecute",
      run: (id, signerAccountId) => deps.multisig.executeProposal(id, signerAccountId),
      success: "Execution submitted",
    },
  ];
  for (const action of actions) {
    deps.app?.querySelectorAll<HTMLButtonElement>(action.attribute).forEach((button) => {
      button.addEventListener("click", () => {
        const proposalId = button.dataset[action.key];
        const signerAccountId = button.dataset["msSignerId"];
        if (!proposalId || !signerAccountId) {
          return;
        }
        const row = button.closest(".allowance-row");
        const requiresAck = button.dataset["msRequiresAck"] === "true";
        const ack = requiresAck
          ? row?.querySelector<HTMLInputElement>("[data-ms-ack]")?.checked
          : undefined;
        if (requiresAck && !ack) {
          showToast("Verify the proposal and check the acknowledgment first", "error");
          return;
        }
        runAction(deps, button, "multisig-proposal-result", "Submitting…", async () => {
          await action.run(proposalId, signerAccountId, ack ? true : undefined);
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
      const packageText = String(data.get("reviewPackage") ?? "").trim();
      const reviewPackage = packageText ? parseMultisigReviewPackage(packageText) : null;
      if (packageText && !reviewPackage) {
        throw new Error("Review package format is invalid");
      }
      if (reviewPackage && reviewPackage.multisig.id !== multisigId) {
        throw new Error("Review package belongs to a different multisig");
      }
      const txId = reviewPackage?.proposal.txId ?? String(data.get("txId") ?? "").trim();
      if (!txId) {
        throw new Error("Enter a proposal id or paste a review package");
      }
      await deps.multisig.trackProposal(
        multisigId,
        txId,
        String(data.get("summary") ?? "").trim() || reviewPackage?.proposal.summary || "",
        reviewPackage?.proposal.call ?? undefined,
      );
      return reviewPackage?.proposal.call
        ? "Proposal call verified and tracked"
        : "Proposal tracked";
    });
  });
};

/**
 * Binds every multisig screen: list, detail, propose, and deploy.
 */
export const bindMultisigs = (deps: MultisigUiDeps): void => {
  bindAddForm(deps);
  bindListActions(deps);
  bindPortfolioTabs(deps);
  bindMultisigConfirmation(deps);
  bindProposalActions(deps);
  bindMultisigReviewTools(deps.app);
  bindTrackForm(deps);
  bindMultisigProposalForm({
    app: deps.app,
    multisig: deps.multisig,
    openDetail: deps.openDetail,
    runAction: (button, resultId, pendingMessage, action) =>
      runAction(deps, button, resultId, pendingMessage, action),
    selectedMultisigId: deps.selectedMultisigId,
    setResult: (id, message) => setResult(deps, id, message),
  });
  bindMultisigDeploy({
    app: deps.app,
    multisig: deps.multisig,
    openList: deps.openList,
    rerender: () => rerender(deps),
    runAction: (button, resultId, pendingMessage, action) =>
      runAction(deps, button, resultId, pendingMessage, action),
    setResult: (id, message) => setResult(deps, id, message),
  });
};
