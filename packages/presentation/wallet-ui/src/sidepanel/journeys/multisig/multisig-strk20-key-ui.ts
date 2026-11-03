/**
 * Binds the multisig private-balance controls. The viewing key stays in the
 * background; this surface only shows whether the wallet holds it.
 */

import { failureTone } from "../../runtime/runtime-errors";
import { buttonBusy, errorLine, showToast } from "../../shared/dom";
import { sendBalanceLabel } from "../send/send-model";
import type { Strk20PanelAuthorization } from "./multisig-strk20-panel";
import type { MultisigUiDeps } from "./multisig-ui-deps";

const STATUS_ID = "multisig-strk20-key-status";

const line = (owner: Document, text: string): HTMLParagraphElement => {
  const paragraph = owner.createElement("p");
  paragraph.textContent = text;
  return paragraph;
};

/**
 * Fills the authorization list. Each card names the action, the amount, and
 * the recipient, then offers Sign unless this wallet already signed.
 */
export const showMultisigStrk20Authorizations = (
  list: HTMLElement,
  reviews: readonly Strk20PanelAuthorization[],
  onSign: (id: string) => void,
): void => {
  const owner = list.ownerDocument;
  list.replaceChildren();
  for (const review of reviews) {
    const card = owner.createElement("article");
    card.className = "review-panel";
    const title = owner.createElement("strong");
    title.textContent = review.summary;
    card.append(title);
    if (review.amount) {
      card.append(line(owner, review.symbol ? `${review.amount} ${review.symbol}` : review.amount));
    }
    if (review.recipient) card.append(line(owner, `To ${review.recipient}`));
    if (review.youSigned) {
      card.append(line(owner, "You signed. Waiting for co-owners."));
    } else {
      const sign = owner.createElement("button");
      sign.type = "button";
      sign.textContent = "Sign";
      sign.dataset["msStrk20Sign"] = review.id;
      sign.addEventListener("click", () => onSign(review.id));
      card.append(sign);
    }
    list.append(card);
  }
};
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
    for (const action of panel.querySelectorAll<HTMLButtonElement>("[data-ms-strk20-action]")) {
      const name = action.dataset["msStrk20Action"];
      action.hidden = state !== "held" || name === "share" || name === "refresh" || name === "send";
    }
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
  const authorizations = panel.querySelector<HTMLElement>("[data-ms-strk20-authorizations]");
  const form = panel.querySelector<HTMLFormElement>("[data-ms-strk20-form]");
  let pendingKind: "deposit" | "transfer" | "withdraw" | null = null;
  let lastId: string | null = null;
  let privateBalances: readonly {
    readonly formatted: string;
    readonly symbol: string;
    readonly tokenId: string;
  }[] = [];
  const tokenSelect = form?.querySelector<HTMLSelectElement>('select[name="tokenId"]');
  const applyTokenLabels = (source: "private" | "public"): void => {
    if (!tokenSelect) return;
    const owner = tokenSelect.ownerDocument;
    if (source === "private") {
      for (const entry of privateBalances) {
        if ([...tokenSelect.options].some((option) => option.value === entry.tokenId)) continue;
        const option = owner.createElement("option");
        option.value = entry.tokenId;
        option.dataset["symbol"] = entry.symbol;
        tokenSelect.add(option);
      }
    }
    for (const option of tokenSelect.options) {
      const symbol = option.dataset["symbol"] || "";
      const formatted =
        source === "private"
          ? privateBalances.find((entry) => entry.tokenId === option.value)?.formatted
          : option.dataset["publicBalance"];
      const label = formatted ? sendBalanceLabel(formatted) : "";
      option.textContent = label ? `${symbol} · ${label}` : symbol;
    }
  };
  const reloadAuthorizations = (): void => {
    const id = deps.selectedMultisigId();
    if (!id || !authorizations) return;
    void deps.multisig.strk20Panel(id).then(
      (state) => {
        privateBalances = state.balances;
        if (pendingKind) applyTokenLabels(pendingKind === "deposit" ? "public" : "private");
        showMultisigStrk20Authorizations(
          authorizations,
          state.authorizations,
          (authorizationId) => {
            void deps.multisig.signStrk20Authorization(authorizationId).then(
              (result) => {
                setStatus(
                  panel,
                  result.phase === "authorization"
                    ? "You signed. Waiting for co-owners."
                    : "You signed.",
                );
                reloadAuthorizations();
              },
              (error: unknown) =>
                setStatus(panel, errorLine(error, "Couldn't prepare this private action.")),
            );
          },
        );
      },
      () => undefined,
    );
  };
  if (multisigId) {
    void deps.multisig.strk20KeyStatus(multisigId).then(apply, () => {
      setStatus(panel, "Couldn't update this multisig's key.");
    });
    reloadAuthorizations();
  }
  const recipientField = form?.querySelector<HTMLInputElement>('input[name="recipient"]');
  const run = (
    kind: "deposit" | "register" | "transfer" | "withdraw",
    amount?: string,
    recipient?: string,
  ) => {
    const id = deps.selectedMultisigId();
    if (!id) return;
    void deps.multisig
      .prepareStrk20({
        kind,
        multisigId: id,
        ...(amount ? { amount } : {}),
        ...(recipient ? { recipient } : {}),
        ...(kind !== "register" && tokenSelect?.value ? { tokenId: tokenSelect.value } : {}),
      })
      .then(
        (result) => {
          lastId = result.id;
          const share = panel.querySelector<HTMLButtonElement>('[data-ms-strk20-action="share"]');
          const refresh = panel.querySelector<HTMLButtonElement>(
            '[data-ms-strk20-action="refresh"]',
          );
          const send = panel.querySelector<HTMLButtonElement>('[data-ms-strk20-action="send"]');
          if (share) share.hidden = result.phase !== "authorization";
          if (refresh) refresh.hidden = result.phase === "authorization";
          if (send) send.hidden = result.phase !== "relay";
          setStatus(
            panel,
            result.phase === "authorization"
              ? "Waiting for co-owners."
              : result.phase === "intent"
                ? "Sign the transaction."
                : "Send it when the owners are ready.",
          );
        },
        (error: unknown) => {
          setStatus(panel, errorLine(error, "Couldn't prepare this private action."));
        },
      );
  };
  for (const action of panel.querySelectorAll<HTMLButtonElement>("[data-ms-strk20-action]")) {
    action.addEventListener("click", () => {
      const kind = action.dataset["msStrk20Action"];
      if (kind === "share" && lastId) {
        void deps.multisig.shareStrk20Authorization(lastId).then(
          (result) => setStatus(panel, `Shared with ${result.recipients} co-signers.`),
          (error: unknown) =>
            setStatus(panel, errorLine(error, "Couldn't prepare this private action.")),
        );
        return;
      }
      if (kind === "send" && lastId) {
        void deps.multisig.submitStrk20Relay(lastId).then(
          (result) => setStatus(panel, `Sent ${result.transactionHash}.`),
          (error: unknown) =>
            setStatus(panel, errorLine(error, "Couldn't prepare this private action.")),
        );
        return;
      }
      if (kind === "refresh" && lastId) {
        void deps.multisig.refreshStrk20(lastId).then(
          (result) => {
            lastId = result.id;
            setStatus(
              panel,
              result.phase === "authorization" ? "Waiting for co-owners." : "Sign the transaction.",
            );
          },
          (error: unknown) =>
            setStatus(panel, errorLine(error, "Couldn't prepare this private action.")),
        );
        return;
      }
      if (kind === "register") {
        if (form) form.hidden = true;
        run("register");
        return;
      }
      if (kind !== "deposit" && kind !== "transfer" && kind !== "withdraw") return;
      pendingKind = kind;
      if (form) form.hidden = false;
      recipientField?.closest("label")?.toggleAttribute("hidden", kind === "deposit");
      applyTokenLabels(kind === "deposit" ? "public" : "private");
    });
  }
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!pendingKind || !form) return;
    const data = new FormData(form);
    const amount = String(data.get("amount") ?? "").trim();
    const recipient = pendingKind === "deposit" ? "" : String(data.get("recipient") ?? "").trim();
    run(pendingKind, amount, recipient || undefined);
  });

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
