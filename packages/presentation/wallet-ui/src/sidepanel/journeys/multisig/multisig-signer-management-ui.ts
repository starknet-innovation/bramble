/** Guided Argent multisig signer-management bindings. */
import {
  type ArgentMultisigConfigChange,
  argentMultisigConfigChangeCall,
} from "@bramble/multisig/chain";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { normalizeFeltInput, sameFelt } from "@bramble/wallet-model/networks";
import { buttonBusy, errorLine, errorMessage, showToast } from "../../shared/dom";
import { accountLabel } from "../../shared/parts";
import { bindMultisigParticipantPicker, type MultisigParticipant } from "./multisig-participant";
import type { MultisigUiDeps } from "./multisig-ui-deps";

const setResult = (deps: MultisigUiDeps, id: string, value: string): void => {
  const target = deps.app?.querySelector<HTMLElement>(`#${id}`);
  if (target) target.textContent = value;
};

const signerChangeFrom = (form: HTMLFormElement): ArgentMultisigConfigChange => {
  const data = new FormData(form);
  const action = form.dataset["msManage"];
  const threshold = Number(data.get("threshold"));
  if (action === "threshold") return { kind: "change_threshold", threshold };
  const selected = String(data.get("selectedPublicKey") ?? "");
  const entered = String(data.get("publicKey") ?? "");
  const publicKey = normalizeFeltInput(entered.trim() || selected);
  if (action === "replace") {
    return {
      addSignerPublicKey: publicKey,
      kind: "replace_signer",
      removeSignerPublicKey: normalizeFeltInput(String(data.get("removePublicKey") ?? "")),
    };
  }
  if (action === "add") {
    return { kind: "add_signers", signerPublicKeys: [publicKey], threshold };
  }
  if (action === "remove") {
    return { kind: "remove_signers", signerPublicKeys: [publicKey], threshold };
  }
  throw new Error("Unsupported signer-management action");
};

const bindSignerManagement = (deps: MultisigUiDeps): void => {
  deps.app?.querySelectorAll<HTMLFormElement>("[data-ms-manage]").forEach((form) => {
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (form.dataset["msManage"] === "add") {
      const selectedKey = form.querySelector<HTMLInputElement>('[name="selectedPublicKey"]');
      const selection = form.querySelector<HTMLElement>("[data-participant-selection]");
      const selectionName = form.querySelector<HTMLElement>("[data-participant-selection-name]");
      const selectionDetail = form.querySelector<HTMLElement>(
        "[data-participant-selection-detail]",
      );
      const currentKeys = (form.dataset["currentSignerKeys"] ?? "").split(/\s+/).filter(Boolean);
      const selectParticipant = (participant: MultisigParticipant): string | null => {
        if (currentKeys.some((key) => sameFelt(key, participant.publicKeyX))) {
          return "That participant is already a current signer.";
        }
        if (!selectedKey || !selection || !selectionName || !selectionDetail || !button) {
          return "Signer management is unavailable.";
        }
        selectedKey.value = participant.publicKeyX;
        selectionName.textContent = participant.label;
        selectionDetail.textContent = `${participant.source}${participant.address ? ` · ${accountLabel(participant.address)}` : ""} · Key ${accountLabel(participant.publicKeyX)}`;
        const copy = selection.querySelector<HTMLButtonElement>(
          "[data-participant-selection-copy]",
        );
        if (copy) {
          copy.dataset["copy"] = participant.address ?? "";
          copy.hidden = !participant.address;
        }
        selection.hidden = false;
        button.disabled = false;
        return null;
      };
      bindMultisigParticipantPicker(
        form.closest<HTMLElement>("#wallet-screen-multisig-signers") ?? form,
        {
          multisig: deps.multisig,
          onSelect: selectParticipant,
          saveContact: (participant) =>
            deps.wallet.saveAddress(
              participant.label,
              participant.address,
              form
                .closest<HTMLElement>("#wallet-screen-multisig-signers")
                ?.querySelector<HTMLElement>("[data-participant-network]")?.dataset[
                "participantNetwork"
              ] ?? "",
              participant.publicKeyX,
              participant.nostrPublicKey,
            ),
        },
      );
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const multisigId = form.dataset["multisigId"];
      const address = multisigId?.slice(multisigId.indexOf(":") + 1);
      if (!multisigId || !address) return;
      buttonBusy(button, true);
      void Promise.resolve()
        .then(() => argentMultisigConfigChangeCall(address, signerChangeFrom(form)))
        .then((call) => deps.multisig.prepareIntent(multisigId, [call]))
        .then(
          () => {
            showToast("Signer change ready for multisig review", "success", button ?? form);
            deps.openDetail(multisigId, "multisig-detail");
          },
          (error: unknown) => {
            setResult(
              deps,
              "multisig-signers-result",
              errorLine(error, "Couldn't prepare that signer change"),
            );
            showToast(errorMessage(error, "Prepare signer change failed"), "error", button ?? form);
            buttonBusy(button, false);
          },
        );
    });
  });
};

const bindCompleteSignerConfig = (deps: MultisigUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-complete-config-form");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  const editableKeys = [...(form?.querySelectorAll<HTMLInputElement>("[data-signer-key]") ?? [])];
  for (const input of editableKeys) {
    input.addEventListener("input", () => {
      input.setCustomValidity("");
      input.removeAttribute("aria-invalid");
      setResult(deps, "multisig-complete-config-result", "");
    });
  }
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const multisigId = form.dataset["multisigId"];
    const separator = multisigId?.indexOf(":") ?? -1;
    if (!multisigId || separator < 1) return;
    const data = new FormData(form);
    const signerGuids = data.getAll("signerGuid").map(String);
    const seenGuids: string[] = [];
    for (const input of form.querySelectorAll<HTMLInputElement>('[name="signerPublicKey"]')) {
      let guid: string;
      try {
        guid = argentSignerGuid(normalizeFeltInput(input.value));
      } catch {
        guid = "";
      }
      const message =
        guid === ""
          ? "Enter a valid Stark public key."
          : !signerGuids.some((expected) => sameFelt(expected, guid))
            ? "This public key is not a current Stark signer for this multisig."
            : seenGuids.some((seen) => sameFelt(seen, guid))
              ? "Each signer public key can only be added once."
              : null;
      if (message) {
        input.setCustomValidity(message);
        input.setAttribute("aria-invalid", "true");
        setResult(deps, "multisig-complete-config-result", message);
        showToast(message, "error", input);
        return;
      }
      seenGuids.push(guid);
    }
    const signerPublicKeys = data
      .getAll("signerPublicKey")
      .map(String)
      .filter(Boolean)
      .map(normalizeFeltInput);
    buttonBusy(button, true);
    void deps.multisig
      .addMultisig({
        address: multisigId.slice(separator + 1),
        networkId: multisigId.slice(0, separator),
        signerPublicKeys,
      })
      .then(
        async () => {
          showToast("Signer setup verified and saved", "success", button ?? form);
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          setResult(
            deps,
            "multisig-complete-config-result",
            errorLine(error, "Couldn't finish signer setup"),
          );
          showToast(errorMessage(error, "Complete signer setup failed"), "error", button ?? form);
          buttonBusy(button, false);
        },
      );
  });
};

/**
 * Binds guided signer changes. Untrusted form and runtime failures stay
 * visible, preserve the review boundary, and fail closed.
 */
export const bindMultisigSignerManagement = (deps: MultisigUiDeps): void => {
  bindSignerManagement(deps);
  bindCompleteSignerConfig(deps);
};
