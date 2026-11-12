/**
 * Binds the multisig private-balance controls. The viewing key stays in the
 * background; this surface only shows whether the wallet holds it.
 */

import { t } from "../../../i18n/messages";
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
          ? t("multisig.sync.keyConflict")
          : state === "held"
            ? t("multisig.strk20.held")
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
                      ? t("multisig.strk20.waiting")
                      : t("multisig.strk20.signIt"),
                  );
                  reloadAuthorizations();
                },
                (error: unknown) =>
                  setStatus(panel, errorLine(error, t("multisig.strk20.prepareFailed"))),
              );
            },
            onSend: (authorizationId) => {
              void deps.multisig.submitStrk20Relay(authorizationId).then(
                (result) =>
                  setStatus(panel, t("multisig.strk20.sent", { hash: result.transactionHash })),
                (error: unknown) =>
                  setStatus(panel, errorLine(error, t("multisig.strk20.prepareFailed"))),
              );
            },
            onShare: (authorizationId) => {
              void deps.multisig.shareStrk20Authorization(authorizationId).then(
                (result) =>
                  setStatus(
                    panel,
                    t("multisig.strk20.sharedWith", { count: String(result.recipients) }),
                  ),
                (error: unknown) =>
                  setStatus(panel, errorLine(error, t("multisig.strk20.prepareFailed"))),
              );
            },
            onSign: (authorizationId) => {
              void deps.multisig.signStrk20Authorization(authorizationId).then(
                (result) => {
                  setStatus(
                    panel,
                    result.phase === "authorization"
                      ? t("multisig.strk20.signedWaiting")
                      : t("multisig.strk20.signed"),
                  );
                  reloadAuthorizations();
                },
                (error: unknown) =>
                  setStatus(panel, errorLine(error, t("multisig.strk20.prepareFailed"))),
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
      loading.textContent = errorLine(error, t("multisig.strk20.loadFailed"));
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
              ? t("multisig.strk20.waiting")
              : result.phase === "intent"
                ? t("multisig.strk20.signIt")
                : t("multisig.strk20.sendWhenReady"),
          );
          reloadAuthorizations();
        },
        (error: unknown) => {
          setStatus(panel, errorLine(error, t("multisig.strk20.prepareFailed")));
        },
      );
  };
  for (const action of panel.querySelectorAll<HTMLButtonElement>("[data-ms-strk20-action]")) {
    action.addEventListener("click", () => {
      const kind = action.dataset["msStrk20Action"];
      if (kind === "share" && lastId) {
        void deps.multisig.shareStrk20Authorization(lastId).then(
          (result) =>
            setStatus(panel, t("multisig.strk20.sharedWith", { count: String(result.recipients) })),
          (error: unknown) =>
            setStatus(panel, errorLine(error, t("multisig.strk20.prepareFailed"))),
        );
        return;
      }
      if (kind === "send" && lastId) {
        void deps.multisig.submitStrk20Relay(lastId).then(
          (result) => setStatus(panel, t("multisig.strk20.sent", { hash: result.transactionHash })),
          (error: unknown) =>
            setStatus(panel, errorLine(error, t("multisig.strk20.prepareFailed"))),
        );
        return;
      }
      if (kind === "refresh" && lastId) {
        void deps.multisig.refreshStrk20(lastId).then(
          (result) => {
            lastId = result.id;
            setStatus(
              panel,
              result.phase === "authorization"
                ? t("multisig.strk20.waiting")
                : t("multisig.strk20.signIt"),
            );
          },
          (error: unknown) =>
            setStatus(panel, errorLine(error, t("multisig.strk20.prepareFailed"))),
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
        setStatus(panel, t("multisig.strk20.dropPrompt"));
        return;
      }
      dropArmed = false;
      buttonBusy(button, true);
      const work =
        action === "share"
          ? deps.multisig.shareStrk20Key(id).then((result) =>
              result.recipients < result.totalRecipients
                ? t("multisig.strk20.partialShare", {
                    reached: String(result.recipients),
                    total: String(result.totalRecipients),
                  })
                : t(
                    result.recipients === 1
                      ? "multisig.intents.sharedOne"
                      : "multisig.intents.sharedMany",
                    { count: String(result.recipients) },
                  ),
            )
          : action === "drop"
            ? deps.multisig.forgetStrk20Key(id).then(() => t("multisig.strk20.forgot"))
            : deps.multisig.createStrk20Key(id).then(() => t("multisig.strk20.held"));
      void work.then(
        async (message) => {
          showToast(message, "success", button);
          await deps.render(await deps.wallet.loadStatus());
        },
        (error: unknown) => {
          setStatus(panel, errorLine(error, t("multisig.strk20.updateFailed")));
          showToast(
            errorLine(error, t("multisig.strk20.updateFailed")),
            failureTone(error),
            button,
          );
          buttonBusy(button, false);
        },
      );
    });
  }
};
