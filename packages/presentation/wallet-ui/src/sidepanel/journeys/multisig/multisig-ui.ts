/** Bindings for watched Argent multisigs and frozen signing intents. */

import { argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import { buildErc20TransferCall, parseTokenAmount } from "@mc-wallet/starknet/rpc";
import {
  canonicalFelt,
  normalizeFeltInput,
  STRK_TOKEN_ADDRESS,
  sameFelt,
} from "@mc-wallet/wallet-model/networks";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { formatFiat } from "../../shared/fiat";
import { balanceShortcut, tokenInputFiat } from "../send/send-model";
import { bindMultisigDeploy } from "./multisig-deploy-ui";
import { parseArgentMultisigIntentPackage, parseArgentMultisigSignature } from "./multisig-model";
import type { MultisigUiDeps } from "./multisig-ui-deps";

/**
 * Capabilities required by the Argent multisig UI binder.
 */
export type { MultisigUiDeps } from "./multisig-ui-deps";

const rerender = async (deps: MultisigUiDeps): Promise<void> =>
  deps.render(await deps.wallet.loadStatus());

const setResult = (deps: MultisigUiDeps, id: string, value: string): void => {
  const target = deps.app?.querySelector<HTMLElement>(`#${id}`);
  if (target) target.textContent = value;
};

const run = (
  deps: MultisigUiDeps,
  button: HTMLButtonElement | null | undefined,
  resultId: string,
  action: () => Promise<string>,
): void => {
  buttonBusy(button, true);
  void action().then(
    async (message) => {
      showToast(message, "success", button ?? deps.app);
      await rerender(deps);
    },
    (error: unknown) => {
      const message = errorMessage(error, "Argent multisig request failed");
      setResult(deps, resultId, message);
      showToast(message, "error", button ?? deps.app);
      buttonBusy(button, false);
    },
  );
};

const parseFelts = (value: string): readonly string[] =>
  value
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(normalizeFeltInput);

const bindAdd = (deps: MultisigUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-add-form");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    buttonBusy(button, true);
    void deps.wallet
      .loadStatus()
      .then(async (status) => {
        const view = await deps.multisig.addMultisig({
          address: normalizeFeltInput(String(data.get("address") ?? "")),
          networkId: status.networkId,
        });
        const matched = status.accounts.filter(
          (candidate) =>
            candidate.networkId === view.record.networkId &&
            view.config?.signerGuids.some((guid) =>
              sameFelt(guid, argentSignerGuid(candidate.publicKeyX)),
            ),
        ).length;
        showToast(
          matched === 0
            ? "Multisig synced · watch-only"
            : `Multisig synced · ${matched} wallet signer${matched === 1 ? "" : "s"} found`,
          "success",
          button ?? deps.app,
        );
        deps.openDetail(view.record.id, "multisig-home");
      })
      .catch((error: unknown) => {
        showToast(errorMessage(error, "Sync Argent multisig failed"), "error", button ?? deps.app);
        buttonBusy(button, false);
      });
  });
};

const bindList = (deps: MultisigUiDeps): void => {
  const confirmedRemovals = new WeakSet<HTMLButtonElement>();
  deps.app
    ?.querySelector<HTMLButtonElement>("#multisig-list-retry")
    ?.addEventListener("click", () => {
      void rerender(deps);
    });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-multisig-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["multisigOpen"];
      if (id) deps.openDetail(id);
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-multisig-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["multisigRemove"];
      if (!id) return;
      run(deps, button, "multisig-detail-result", async () => {
        try {
          await deps.multisig.removeMultisig(id, confirmedRemovals.has(button));
        } catch (error) {
          if (
            !confirmedRemovals.has(button) &&
            error instanceof Error &&
            /history|terminal|intent/i.test(error.message)
          ) {
            confirmedRemovals.add(button);
            button.lastChild?.replaceWith("Confirm removal and delete terminal history");
            throw new Error("Review the warning and click again to delete terminal history");
          }
          throw error;
        }
        deps.openList();
        return "Argent multisig removed from this wallet";
      });
    });
  });
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

const intentById = async (deps: MultisigUiDeps, id: string) => {
  const loaded = await deps.multisig.loadMultisigs();
  return loaded === "error" ? null : (loaded.intents.find((intent) => intent.id === id) ?? null);
};

const bindIntentCards = (deps: MultisigUiDeps): void => {
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
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-sign]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msSign"];
      const signer = button
        .closest("[data-ms-intent]")
        ?.querySelector<HTMLSelectElement>('select[name="signerAccountId"]')?.value;
      if (!id || !signer) return;
      run(deps, button, "multisig-intent-result", async () => {
        const result = await deps.multisig.signIntent(id, signer);
        return `Exact transaction signed (${result.intent.signatures.length}/${result.intent.configSnapshot.threshold})`;
      });
    });
  });
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-submit]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["msSubmit"];
      if (!id) return;
      run(deps, button, "multisig-intent-result", async () => {
        const result = await deps.multisig.submitIntent(id);
        return `Argent multisig transaction submitted: ${result.transactionHash ?? result.intent.prepared.transactionHash}`;
      });
    });
  });
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
      run(deps, form.querySelector('button[type="submit"]'), "multisig-intent-result", async () => {
        await deps.multisig.importSignature(id, signature);
        return "Signature verified and imported";
      });
    });
  });
};

const formInput = (form: HTMLFormElement, name: string): HTMLInputElement | null =>
  form.querySelector<HTMLInputElement>(`input[name="${name}"]`);

const setFormValue = (form: HTMLFormElement, name: string, value: string): void => {
  const input = formInput(form, name);
  if (input) input.value = value;
};

const updateTransferAmount = (form: HTMLFormElement): void => {
  const amount = formInput(form, "amount")?.value ?? "";
  const priceText = formInput(form, "tokenPrice")?.value ?? "";
  const estimate = tokenInputFiat(amount, priceText ? Number(priceText) : undefined);
  const target = form.querySelector("#multisig-fiat-estimate");
  if (target) {
    target.textContent = `Estimated value ${estimate === null ? "—" : formatFiat(estimate, form.dataset["currency"] === "eur" || form.dataset["currency"] === "gbp" ? form.dataset["currency"] : "usd")}`;
  }
};

const applyTransferAsset = (form: HTMLFormElement, button: HTMLButtonElement): void => {
  const values = {
    tokenAddress: button.dataset["msAssetAddress"] ?? "",
    tokenBalance: button.dataset["msAssetBalance"] ?? "",
    tokenDecimals: button.dataset["msAssetDecimals"] ?? "0",
    tokenFormatted: button.dataset["msAssetFormatted"] ?? "",
    tokenPrice: button.dataset["msAssetPrice"] ?? "",
    tokenSymbol: button.dataset["msAssetSymbol"] ?? "token",
  };
  for (const [name, value] of Object.entries(values)) setFormValue(form, name, value);
  const glyph = form.querySelector("#multisig-selected-token-glyph");
  const source = button.querySelector(".send-asset-glyph");
  if (glyph && source) {
    glyph.replaceChildren(...Array.from(source.childNodes, (node) => node.cloneNode(true)));
  }
  const symbol = form.querySelector("#multisig-selected-token-symbol");
  if (symbol) symbol.textContent = values.tokenSymbol;
  const balance = form.querySelector("#multisig-balance-label");
  if (balance) {
    balance.textContent = `Balance ${values.tokenFormatted || "—"} ${values.tokenSymbol}`;
  }
  const isFeeToken = sameFelt(values.tokenAddress, STRK_TOKEN_ADDRESS);
  form
    .querySelector("#multisig-max")
    ?.toggleAttribute("hidden", isFeeToken || !values.tokenBalance);
  form.querySelector("#multisig-amount-guidance")?.toggleAttribute("hidden", !isFeeToken);
  form.querySelector<HTMLDetailsElement>(".multisig-asset-picker")?.removeAttribute("open");
  updateTransferAmount(form);
  formInput(form, "amount")?.focus({ preventScroll: true });
};

const bindTransferComposer = (form: HTMLFormElement): void => {
  const recipient = formInput(form, "recipient");
  recipient?.addEventListener("input", () => {
    const query = recipient.value.trim().toLowerCase();
    let visible = 0;
    form.querySelectorAll<HTMLButtonElement>("[data-ms-propose-recipient]").forEach((row) => {
      const matches = !query || (row.dataset["msRecipientSearch"] ?? "").includes(query);
      row.toggleAttribute("hidden", !matches);
      if (matches) visible += 1;
    });
    form.querySelector("#multisig-recipient-empty")?.toggleAttribute("hidden", visible > 0);
  });
  form.querySelectorAll<HTMLButtonElement>("[data-ms-propose-recipient]").forEach((row) => {
    row.addEventListener("click", () => {
      if (!recipient) return;
      recipient.value = row.dataset["msProposeRecipient"] ?? "";
      recipient.setCustomValidity("");
      form.querySelector<HTMLDetailsElement>(".multisig-recipient-picker")?.removeAttribute("open");
      formInput(form, "amount")?.focus({ preventScroll: true });
    });
  });
  form.querySelector("#multisig-asset-search")?.addEventListener("input", (event) => {
    const query =
      event.currentTarget instanceof HTMLInputElement
        ? event.currentTarget.value.trim().toLowerCase()
        : "";
    let visible = 0;
    form.querySelectorAll<HTMLButtonElement>("[data-ms-propose-asset]").forEach((row) => {
      const matches = !query || (row.dataset["msAssetSearch"] ?? "").includes(query);
      row.toggleAttribute("hidden", !matches);
      if (matches) visible += 1;
    });
    form.querySelector("#multisig-asset-empty")?.toggleAttribute("hidden", visible > 0);
  });
  form.querySelectorAll<HTMLButtonElement>("[data-ms-propose-asset]").forEach((asset) => {
    asset.addEventListener("click", () => applyTransferAsset(form, asset));
  });
  formInput(form, "amount")?.addEventListener("input", () => updateTransferAmount(form));
  form.querySelector("#multisig-max")?.addEventListener("click", () => {
    const amount = formInput(form, "amount");
    if (!amount) return;
    amount.value = balanceShortcut(
      formInput(form, "tokenBalance")?.value ?? "",
      Number(formInput(form, "tokenDecimals")?.value ?? "0"),
      "max",
    );
    updateTransferAmount(form);
    amount.focus();
  });
};

const preparedCall = (form: HTMLFormElement) => {
  const data = new FormData(form);
  if (form.dataset["msPrepare"] === "transfer") {
    const amount = parseTokenAmount(
      String(data.get("amount") ?? ""),
      Number(data.get("tokenDecimals")),
    );
    const balance = String(data.get("tokenBalance") ?? "");
    if (balance && amount > BigInt(balance)) {
      throw new Error("Amount exceeds the shared account balance");
    }
    const call = buildErc20TransferCall(
      normalizeFeltInput(String(data.get("tokenAddress") ?? "")),
      normalizeFeltInput(String(data.get("recipient") ?? "")),
      amount,
    );
    if (!Array.isArray(call.calldata)) throw new Error("Transfer calldata is unavailable");
    const calldata: string[] = [];
    for (const felt of call.calldata) {
      if (typeof felt !== "string") throw new Error("Transfer calldata is unavailable");
      const canonical = canonicalFelt(felt);
      if (canonical === null) throw new Error("Transfer calldata is unavailable");
      calldata.push(canonical);
    }
    return {
      calldata,
      contractAddress: normalizeFeltInput(call.contractAddress),
      entrypoint: call.entrypoint,
    };
  }
  return {
    calldata: parseFelts(String(data.get("calldata") ?? "")),
    contractAddress: normalizeFeltInput(String(data.get("contractAddress") ?? "")),
    entrypoint: String(data.get("entrypoint") ?? "").trim(),
  };
};

const bindPrepare = (deps: MultisigUiDeps): void => {
  deps.app?.querySelectorAll<HTMLFormElement>("[data-ms-prepare]").forEach((form) => {
    if (form.dataset["msPrepare"] === "transfer") bindTransferComposer(form);
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const label = button
      ? Array.from(button.childNodes).find((node) => node.nodeType === 3)
      : undefined;
    const idleLabel = label?.textContent ?? "";
    const setPreparing = (preparing: boolean): void => {
      buttonBusy(button, preparing);
      if (preparing) form.setAttribute("aria-busy", "true");
      else form.removeAttribute("aria-busy");
      if (label) label.textContent = preparing ? "Preparing review…" : idleLabel;
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const multisigId = form.dataset["multisigId"];
      if (!multisigId) return;
      setPreparing(true);
      void Promise.resolve()
        .then(() => deps.multisig.prepareIntent(multisigId, [preparedCall(form)]))
        .then(
          () => {
            showToast("Transaction ready for multisig review", "success", button ?? deps.app);
            deps.openDetail(multisigId, "multisig-detail");
          },
          (error: unknown) => {
            showToast(
              errorMessage(error, "Prepare Argent multisig transaction failed"),
              "error",
              button ?? deps.app,
            );
            setPreparing(false);
          },
        );
    });
  });
};

const bindImport = (deps: MultisigUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-track-form");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const intentPackage = parseArgentMultisigIntentPackage(
      String(new FormData(form).get("intentPackage") ?? ""),
    );
    if (!intentPackage) {
      showToast("Intent package is invalid", "error", form);
      return;
    }
    run(deps, button, "multisig-track-result", async () => {
      const result = await deps.multisig.importIntent(intentPackage);
      deps.openDetail(result.intent.accountId, "multisig-detail");
      return "Intent verified and ready to review";
    });
  });
};

type MultisigHomeTab = "assets" | "collectibles" | "intents";
const bindTabs = (deps: MultisigUiDeps): void => {
  const tabs = Array.from(
    deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-home-tab]") ?? [],
  );
  const apply = (selected: MultisigHomeTab): void => {
    for (const tab of tabs) {
      const active = tab.dataset["msHomeTab"] === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    deps.app?.querySelectorAll<HTMLElement>("[data-ms-home-panel]").forEach((panel) => {
      const target = panel;
      target.hidden = target.dataset["msHomePanel"] !== selected;
    });
  };
  for (const [index, button] of tabs.entries()) {
    button.addEventListener("click", () => {
      const value = button.dataset["msHomeTab"];
      if (value === "assets" || value === "collectibles" || value === "intents") apply(value);
    });
    button.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      const nextTab = tabs[next];
      const value = nextTab?.dataset["msHomeTab"];
      if (!nextTab || (value !== "assets" && value !== "collectibles" && value !== "intents")) {
        return;
      }
      event.preventDefault();
      apply(value);
      nextTab.focus();
    });
  }
};

/**
 * Binds every current Argent multisig surface; runtime failures stay visible.
 */
export const bindMultisigs = (deps: MultisigUiDeps): void => {
  bindAdd(deps);
  bindList(deps);
  bindIntentCards(deps);
  bindPrepare(deps);
  bindImport(deps);
  bindTabs(deps);
  bindMultisigDeploy({
    app: deps.app,
    multisig: deps.multisig,
    openList: deps.openList,
    rerender: () => rerender(deps),
    setResult: (id, message) => setResult(deps, id, message),
  });
};
