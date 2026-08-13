/** Bindings for watched Argent multisigs and frozen signing intents. */
import { normalizeFeltInput } from "@mc-wallet/wallet-model/networks";
import { buttonBusy, errorMessage, showToast } from "../../shared/dom";
import { formatFeeEstimate } from "../../shared/review-render";
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
      showToast(message, "success");
      await rerender(deps);
    },
    (error: unknown) => {
      const message = errorMessage(error, "Argent multisig request failed");
      setResult(deps, resultId, message);
      showToast(message, "error");
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
    const signerAccountId = String(data.get("signerAccountId") ?? "");
    run(deps, button, "multisig-add-result", async () => {
      await deps.multisig.addMultisig({
        address: normalizeFeltInput(String(data.get("address") ?? "")),
        ...(String(data.get("name") ?? "").trim()
          ? { name: String(data.get("name") ?? "").trim() }
          : {}),
        networkId: signerAccountId.split(":")[0] ?? "",
        signerAccountId,
        signerPublicKeys: parseFelts(String(data.get("signerPublicKeys") ?? "")),
        threshold: Number(data.get("threshold")),
      });
      return "Argent multisig verified and added";
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

const copyText = async (value: string, message: string): Promise<void> => {
  await navigator.clipboard.writeText(value);
  showToast(message, "success");
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
            JSON.stringify({ intent, kind: "mc-wallet.argent-multisig-intent", version: 1 }),
            "Intent package copied",
          );
        })
        .catch((error: unknown) => showToast(errorMessage(error, "Copy failed"), "error"));
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
          return copyText(JSON.stringify(signature), "Signature fragment copied");
        })
        .catch((error: unknown) => showToast(errorMessage(error, "Copy failed"), "error"));
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
        showToast("Signature fragment is invalid", "error");
        return;
      }
      run(deps, form.querySelector('button[type="submit"]'), "multisig-intent-result", async () => {
        await deps.multisig.importSignature(id, signature);
        return "Signature verified and imported";
      });
    });
  });
};

const bindPrepare = (deps: MultisigUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#multisig-propose-form");
  const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const multisigId = form.dataset["multisigId"];
    if (!multisigId) return;
    const data = new FormData(form);
    run(deps, button, "multisig-propose-result", async () => {
      const result = await deps.multisig.prepareIntent(multisigId, [
        {
          calldata: parseFelts(String(data.get("calldata") ?? "")),
          contractAddress: normalizeFeltInput(String(data.get("contractAddress") ?? "")),
          entrypoint: String(data.get("entrypoint") ?? "").trim(),
        },
      ]);
      return `Exact intent prepared · maximum fee ${result.feeReview ? formatFeeEstimate(result.feeReview) : "bound in package"}`;
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
      showToast("Intent package is invalid", "error");
      return;
    }
    run(deps, button, "multisig-track-result", async () => {
      await deps.multisig.importIntent(intentPackage);
      return "Frozen intent verified and imported";
    });
  });
};

type MultisigHomeTab = "assets" | "collectibles" | "intents";
const bindTabs = (deps: MultisigUiDeps): void => {
  const apply = (selected: MultisigHomeTab): void => {
    deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-home-tab]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset["msHomeTab"] === selected));
    });
    deps.app?.querySelectorAll<HTMLElement>("[data-ms-home-panel]").forEach((panel) => {
      const target = panel;
      target.hidden = target.dataset["msHomePanel"] !== selected;
    });
  };
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-ms-home-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset["msHomeTab"];
      if (value === "assets" || value === "collectibles" || value === "intents") apply(value);
    });
  });
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
