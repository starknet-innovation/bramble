/**
 * Binds the multisig private-balance controls. The viewing key stays in the
 * background; this surface only shows whether the wallet holds it.
 */

import { failureTone } from "../../runtime/runtime-errors";
import { buttonBusy, errorLine, showToast } from "../../shared/dom";
import { sendBalanceLabel } from "../send/send-model";
import type { Strk20PanelCard } from "./multisig-strk20-panel";
import type { MultisigUiDeps } from "./multisig-ui-deps";

const STATUS_ID = "multisig-strk20-key-status";

const line = (owner: Document, text: string): HTMLParagraphElement => {
  const paragraph = owner.createElement("p");
  paragraph.textContent = text;
  return paragraph;
};

const control = (
  owner: Document,
  label: string,
  id: string,
  name: string,
  onClick: (id: string) => void,
): HTMLButtonElement => {
  const button = owner.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset[name] = id;
  button.addEventListener("click", () => onClick(id));
  return button;
};

/**
 * Fills the authorization list from facts the digest covers. Sign, Share,
 * Send, and Refresh stay on the card, including after it is ready.
 */
export const showMultisigStrk20Authorizations = (
  list: HTMLElement,
  reviews: readonly Strk20PanelCard[],
  handlers: {
    readonly onRefresh: (id: string) => void;
    readonly onSend: (id: string) => void;
    readonly onShare: (id: string) => void;
    readonly onSign: (id: string) => void;
  },
): void => {
  const owner = list.ownerDocument;
  list.replaceChildren();
  for (const review of reviews) {
    const card = owner.createElement("article");
    card.className = "review-panel";
    const title = owner.createElement("strong");
    title.textContent = review.summary;
    card.append(title);
    for (const text of review.lines) card.append(line(owner, text));
    if (review.offer === "sign") {
      card.append(control(owner, "Sign", review.id, "msStrk20Sign", handlers.onSign));
    } else if (review.offer === "share") {
      card.append(control(owner, "Share", review.id, "msStrk20Share", handlers.onShare));
    } else {
      card.append(control(owner, "Send", review.id, "msStrk20Send", handlers.onSend));
    }
    if (review.refresh) {
      card.append(control(owner, "Refresh", review.id, "msStrk20Refresh", handlers.onRefresh));
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
  const loading = panel.querySelector<HTMLElement>("[data-ms-strk20-key-loading]");

  const apply = (state: "absent" | "conflict" | "held"): void => {
    loading?.remove();
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
          [...state.authorizations, ...state.relays],
          {
            onRefresh: (authorizationId) => {
              void deps.multisig.refreshStrk20(authorizationId).then(
                (result) => {
                  lastId = result.id;
                  setStatus(
                    panel,
                    result.phase === "authorization"
                      ? "Waiting for co-owners."
                      : "Sign the transaction.",
                  );
                  reloadAuthorizations();
                },
                (error: unknown) =>
                  setStatus(panel, errorLine(error, "Couldn't prepare this private action.")),
              );
            },
            onSend: (authorizationId) => {
              void deps.multisig.submitStrk20Relay(authorizationId).then(
                (result) => setStatus(panel, `Sent ${result.transactionHash}.`),
                (error: unknown) =>
                  setStatus(panel, errorLine(error, "Couldn't prepare this private action.")),
              );
            },
            onShare: (authorizationId) => {
              void deps.multisig.shareStrk20Authorization(authorizationId).then(
                (result) => setStatus(panel, `Shared with ${result.recipients} co-signers.`),
                (error: unknown) =>
                  setStatus(panel, errorLine(error, "Couldn't prepare this private action.")),
              );
            },
            onSign: (authorizationId) => {
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
          },
        );
      },
      () => undefined,
    );
  };
  if (!multisigId) loading?.remove();
  if (multisigId) {
    // A failed read replaces the loading line with its reason, as an alert, so
    // the section never sits blank with no action and no explanation.
    void deps.multisig.strk20KeyStatus(multisigId).then(apply, (error: unknown) => {
      if (!loading) return;
      loading.textContent = errorLine(error, "Couldn't load private balances. Try again.");
      loading.setAttribute("role", "alert");
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
          setStatus(
            panel,
            result.phase === "authorization"
              ? "Waiting for co-owners."
              : result.phase === "intent"
                ? "Sign the transaction."
                : "Send it when the owners are ready.",
          );
          reloadAuthorizations();
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
