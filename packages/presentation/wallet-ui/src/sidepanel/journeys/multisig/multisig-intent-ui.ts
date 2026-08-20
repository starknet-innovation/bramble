/** DOM bindings for one exact Argent multisig signing intent. */

import {
  ARGENT_MULTISIG_FEE_EXPIRED_MESSAGE,
  isArgentMultisigFeeExpiredMessage,
} from "@mc-wallet/starknet/multisig-invoke";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { parseArgentMultisigSignature } from "./multisig-model";
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

const run = (
  deps: MultisigUiDeps,
  button: HTMLButtonElement | null | undefined,
  action: () => Promise<string>,
): void => {
  buttonBusy(button, true);
  void action().then(
    async (message) => {
      showToast(message, "success", button ?? deps.app);
      await deps.render(await deps.wallet.loadStatus());
    },
    (error: unknown) => {
      const details = errorMessage(error, "Argent multisig request failed");
      const message = isArgentMultisigFeeExpiredMessage(details)
        ? ARGENT_MULTISIG_FEE_EXPIRED_MESSAGE
        : details;
      showToast(message, "error", button ?? deps.app, details);
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
          if (!intent) throw new Error("Signing intent unavailable");
          return copyText(
            button,
            JSON.stringify({ intent, kind: "mc-wallet.argent-multisig-intent", version: 1 }),
            "Intent package copied",
          );
        })
        .catch((error: unknown) => showToast(errorMessage(error, "Copy failed"), "error", button));
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
          if (!signature) throw new Error("Signature fragment unavailable");
          return copyText(button, JSON.stringify(signature), "Signature fragment copied");
        })
        .catch((error: unknown) => showToast(errorMessage(error, "Copy failed"), "error", button));
    });
  });
};

const bindActions = (deps: MultisigUiDeps): void => {
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
      run(deps, button, async () => {
        try {
          const result = await deps.multisig.submitIntent(id);
          return `Argent multisig transaction submitted: ${result.transactionHash ?? result.intent.prepared.transactionHash}`;
        } catch (error) {
          await deps.render(await deps.wallet.loadStatus());
          throw error;
        }
      });
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-refresh-intent]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msRefreshIntent"];
      if (!id) return;
      run(deps, button, async () => {
        const intent = await intentById(deps, id);
        if (!intent) throw new Error("Signing intent unavailable");
        const result = await deps.multisig.prepareIntent(intent.accountId, intent.prepared.calls);
        deps.openIntent(intent.accountId, result.intent.id);
        return "Network fees refreshed. Review and collect signatures for the new intent.";
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
        showToast("Signature fragment is invalid", "error", form);
        return;
      }
      run(deps, form.querySelector('button[type="submit"]'), async () => {
        await deps.multisig.importSignature(id, signature);
        return "Signature verified and imported";
      });
    });
  });
};

/**
 * Binds focused intent navigation, handoff, signing, refresh, and submission.
 */
export const bindMultisigIntentCards = (deps: MultisigUiDeps): void => {
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
};
