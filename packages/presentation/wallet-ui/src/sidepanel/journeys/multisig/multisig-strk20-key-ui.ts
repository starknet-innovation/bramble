/**
 * Binds the multisig private-balance controls. The viewing key stays in the
 * background; this surface only shows whether the wallet holds it.
 */

import { failureTone } from "../../runtime/runtime-errors";
import { buttonBusy, errorLine, showToast } from "../../shared/dom";
import type { MultisigUiDeps } from "./multisig-ui-deps";

const STATUS_ID = "multisig-strk20-key-status";
const DROP_PROMPT =
  "This wallet forgets the viewing key. Co-owners who have it still can. Press again to drop it.";

const setStatus = (root: ParentNode, value: string): void => {
  const target = root.querySelector<HTMLElement>(`#${STATUS_ID}`);
  if (target) target.textContent = value;
};

/**
 * Loads the key state and binds create, share, and drop. Drop asks once, then
 * forgets the key on the second press.
 */
export const bindMultisigStrk20Key = (deps: MultisigUiDeps): void => {
  const panel = deps.app?.querySelector<HTMLElement>("[data-ms-strk20-key-panel]");
  if (!panel) return;
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("[data-ms-strk20-key]")];
  const buttonFor = (action: string): HTMLButtonElement | undefined =>
    buttons.find((button) => button.dataset["msStrk20Key"] === action);
  let dropArmed = false;

  const apply = (state: "absent" | "conflict" | "held"): void => {
    const create = buttonFor("create");
    const share = buttonFor("share");
    const drop = buttonFor("drop");
    if (create) create.hidden = state !== "absent";
    if (share) share.hidden = state === "absent";
    if (drop) drop.hidden = state === "absent";
    if (!dropArmed) {
      setStatus(
        panel,
        state === "conflict"
          ? "A co-owner sent a different viewing key. This wallet kept its own."
          : state === "held"
            ? "This wallet holds the viewing key."
            : "",
      );
    }
  };

  const multisigId = deps.selectedMultisigId();
  if (multisigId) {
    void deps.multisig.strk20KeyStatus(multisigId).then(apply, () => {
      setStatus(panel, "Couldn't update this multisig's key.");
    });
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const action = button.dataset["msStrk20Key"];
      const id = deps.selectedMultisigId();
      if (!id) return;
      if (action === "drop" && !dropArmed) {
        dropArmed = true;
        setStatus(panel, DROP_PROMPT);
        return;
      }
      dropArmed = false;
      buttonBusy(button, true);
      const work =
        action === "share"
          ? deps.multisig
              .shareStrk20Key(id)
              .then((result) =>
                result.recipients < result.totalRecipients
                  ? `Reached ${result.recipients} of ${result.totalRecipients} co-signers. Share again to retry the remaining delivery.`
                  : `Shared securely with ${result.recipients} co-signer${result.recipients === 1 ? "" : "s"}`,
              )
          : action === "drop"
            ? deps.multisig.forgetStrk20Key(id).then(() => "This wallet forgot the viewing key.")
            : deps.multisig.createStrk20Key(id).then(() => "This wallet holds the viewing key.");
      void work.then(
        async (message) => {
          showToast(message, "success", button);
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          setStatus(panel, errorLine(error, "Couldn't update this multisig's key."));
          showToast(
            errorLine(error, "Couldn't update this multisig's key."),
            failureTone(error),
            button,
          );
          buttonBusy(button, false);
        },
      );
    });
  }
};
