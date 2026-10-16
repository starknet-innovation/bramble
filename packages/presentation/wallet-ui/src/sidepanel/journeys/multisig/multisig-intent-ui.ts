/** DOM bindings for one exact Argent multisig signing intent. */

import {
  ARGENT_MULTISIG_FEE_EXPIRED_MESSAGE,
  isArgentMultisigFeeExpiredMessage,
} from "@bramble/starknet/multisig-invoke";
import { failureTone } from "../../runtime/runtime-errors";
import { buttonBusy, errorDetails, errorMessage, showToast } from "../../shared/dom";
import { feeReplacementIntentFor, parseArgentMultisigSignature } from "./multisig-model";
import { armResendConfirmation, resendConfirmed } from "./multisig-resend-confirm";
import type { MultisigUiDeps } from "./multisig-ui-deps";

const intentById = async (deps: MultisigUiDeps, id: string) => {
  const loaded = await deps.multisig.loadMultisigs();
  return loaded === "error" ? null : (loaded.intents.find((intent) => intent.id === id) ?? null);
};

const copyText = async (
  button: HTMLButtonElement,
  value: string,
  message: string,
): Promise<void> => {
  const clipboard = button.ownerDocument.defaultView?.navigator.clipboard;
  if (!clipboard) throw new Error("Clipboard unavailable");
  await clipboard.writeText(value);
  showToast(message, "success", button);
};

const openUpdatedIntent = async (
  deps: MultisigUiDeps,
  id: string,
  confirmResend: boolean,
): Promise<boolean> => {
  const loaded = await deps.multisig.loadMultisigs();
  if (loaded === "error") return false;
  const stale = loaded.intents.find((intent) => intent.id === id);
  if (stale?.state !== "stale") return false;
  const existing = feeReplacementIntentFor(stale, loaded.intents);
  const replacement =
    existing ??
    (await deps.multisig.prepareIntent(stale.accountId, stale.prepared.calls, confirmResend))
      .intent;
  deps.openIntent(stale.accountId, replacement.id);
  return true;
};

const run = (
  deps: MultisigUiDeps,
  button: HTMLButtonElement | null | undefined,
  action: () => Promise<string>,
  options: {
    readonly afterRender?: () => void;
    readonly reconcile?: boolean;
    readonly resetScroll?: boolean;
  } = {},
): void => {
  const doc = button?.ownerDocument ?? deps.app?.ownerDocument;
  buttonBusy(button, true);
  void action().then(
    async (message) => {
      showToast(message, "success", button ?? deps.app);
      await deps.render(await deps.wallet.loadStatus(), options.reconcile ? "action" : undefined);
      options.afterRender?.();
      if (options.resetScroll && doc) {
        doc.documentElement.scrollTop = 0;
        doc.body.scrollTop = 0;
      }
    },
    (error: unknown) => {
      const details = errorMessage(error, "Ready multisig request failed");
      const message = isArgentMultisigFeeExpiredMessage(details)
        ? ARGENT_MULTISIG_FEE_EXPIRED_MESSAGE
        : details;
      showToast(message, failureTone(error), button ?? deps.app, details);
      buttonBusy(button, false);
    },
  );
};

const bindCopies = (deps: MultisigUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-copy-package]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msCopyPackage"];
      if (!id) return;
      void intentById(deps, id)
        .then((intent) => {
          if (!intent) throw new Error("That transaction is unavailable");
          return copyText(
            button,
            JSON.stringify({ intent, kind: "bramble.argent-multisig-intent", version: 1 }),
            "Transaction package copied",
          );
        })
        .catch((error: unknown) => showToast(errorDetails(error, "Copy failed"), "error", button));
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-copy-signature]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msCopySignature"];
      const index = Number(button.dataset["msSignatureIndex"]);
      if (!id || !Number.isSafeInteger(index)) return;
      void intentById(deps, id)
        .then((intent) => {
          const signature = intent?.signatures[index];
          if (!signature) throw new Error("That signature is unavailable");
          return copyText(button, JSON.stringify(signature), "Signature copied");
        })
        .catch((error: unknown) => showToast(errorDetails(error, "Copy failed"), "error", button));
    });
  });
};

const bindActions = (deps: MultisigUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-share]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msShare"];
      if (!id) return;
      run(deps, button, async () => {
        const result = await deps.multisig.shareIntent(id);
        if (result.recipients < result.totalRecipients) {
          throw new Error(
            `Reached ${result.recipients} of ${result.totalRecipients} co-signers. Share again to retry the remaining delivery.`,
          );
        }
        return `Shared securely with ${result.recipients} co-signer${result.recipients === 1 ? "" : "s"}`;
      });
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-sign]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msSign"];
      const signer = button
        .closest("[data-ms-intent]")
        ?.querySelector<HTMLSelectElement>('select[name="signerAccountId"]')?.value;
      if (!id || !signer) return;
      run(deps, button, async () => {
        const result = await deps.multisig.signIntent(id, signer);
        return `Exact transaction signed (${result.intent.signatures.length}/${result.intent.configSnapshot.threshold})`;
      });
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-submit]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msSubmit"];
      if (!id) return;
      run(
        deps,
        button,
        async () => {
          try {
            const result = await deps.multisig.submitIntent(id);
            return `Transaction submitted to Starknet: ${result.transactionHash ?? result.intent.prepared.transactionHash}`;
          } catch (error) {
            await deps.render(await deps.wallet.loadStatus());
            throw error;
          }
        },
        { resetScroll: true },
      );
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-refresh-intent]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msRefreshIntent"];
      if (!id) return;
      run(deps, button, async () => {
        try {
          if (!(await openUpdatedIntent(deps, id, resendConfirmed(button))))
            throw new Error("That transaction is unavailable");
        } catch (error) {
          armResendConfirmation(button, error);
          throw error;
        }
        return button.dataset["msProposeAgain"] === "true"
          ? "Ready to review."
          : "Fee updated. Ready to review.";
      });
    });
  });
};

const bindSignatureImports = (deps: MultisigUiDeps): void => {
  deps.app?.querySelectorAll<HTMLFormElement>("[data-ms-signature-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const id = form.dataset["msSignatureForm"];
      const signature = parseArgentMultisigSignature(
        String(new FormData(form).get("signature") ?? ""),
      );
      if (!id || !signature) {
        showToast("That signature isn't valid", "error", form);
        return;
      }
      run(deps, form.querySelector('button[type="submit"]'), async () => {
        await deps.multisig.importSignature(id, signature);
        return "Signature verified and imported";
      });
    });
  });
};

const bindDeletes = (deps: MultisigUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-delete-intent]").forEach((button) => {
    const control = button;
    control.addEventListener("click", () => {
      const id = control.dataset["msDeleteIntent"];
      const accountId = control.dataset["msIntentAccount"];
      if (!id || !accountId) return;
      if (control.dataset["confirm"] !== "true") {
        control.dataset["confirm"] = "true";
        control.textContent = "Confirm delete";
        control.setAttribute("aria-label", "Tap again to delete");
        control.setAttribute("title", "Tap again to delete");
        return;
      }
      run(deps, control, async () => {
        await deps.multisig.removeIntent(id);
        deps.openDetail(accountId, "multisig-home");
        return "Saved transaction deleted";
      });
    });
  });
};

/**
 * Binds focused intent navigation, handoff, signing, refresh, and submission.
 */
export const bindMultisigIntentCards = (deps: MultisigUiDeps): void => {
  deps.app
    ?.querySelector<HTMLButtonElement>("[data-ms-sync-intents]")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      let updatedIntentIds: readonly string[] = [];
      run(
        deps,
        button,
        async () => {
          const multisigId = deps.selectedMultisigId();
          if (!multisigId) throw new Error("Select a multisig first");
          const result = await deps.multisig.syncIntents(multisigId);
          updatedIntentIds = result.intentIds;
          return result.imported === 0
            ? "No new co-signer updates"
            : `${result.imported} signing intent${result.imported === 1 ? "" : "s"} updated${result.imported === 1 ? "" : ". Review them in Intents"}`;
        },
        {
          reconcile: true,
          afterRender: () => {
            const multisigId = deps.selectedMultisigId();
            if (multisigId && updatedIntentIds.length === 1 && updatedIntentIds[0]) {
              deps.openIntent(multisigId, updatedIntentIds[0]);
              return;
            }
            const tab = deps.app?.querySelector<HTMLButtonElement>('[data-ms-home-tab="intents"]');
            tab?.click();
            (deps.app?.querySelector<HTMLButtonElement>("[data-ms-sync-intents]") ?? tab)?.focus({
              preventScroll: true,
            });
          },
        },
      );
    });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-open-intent]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = button.dataset["msIntentAccount"];
      const intentId = button.dataset["msOpenIntent"];
      if (accountId && intentId) deps.openIntent(accountId, intentId);
    });
  });
  bindCopies(deps);
  bindActions(deps);
  bindSignatureImports(deps);
  bindDeletes(deps);
};
