/**
 * NFT gallery bindings: add a watched NFT after on-chain ownership is proven,
 * open a collectible's detail screen, toggle spam-hide, remove, and send
 * through the verified invoke path.
 */
import type { TransferReviewResponse, WalletStatus } from "../popup/responses";
import { escapeHtml } from "../shared/html";
import { normalizeFeltInput } from "../starknet/networks";
import { buttonBusy, errorMessage, renderFragment, showToast } from "./dom";
import { icon } from "./icons";
import type { SidepanelWallet } from "./runtime";
import { watchDeployment } from "./shell-bindings";
import { friendlyReviewError, recipientFieldError, reviewPanelHtml } from "./transfer-ui";

/**
 * Dependencies the NFT bindings close over. `openDetail` navigates to the NFT
 * detail screen for the given watched-NFT id.
 */
export type NftUiDeps = {
  readonly app: Element | null;
  readonly openDetail: (id: string) => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

const rerender = async (deps: NftUiDeps): Promise<void> => {
  await deps.render(await deps.wallet.loadStatus());
};

type NftReviewElements = {
  readonly form: HTMLFormElement;
  readonly result: HTMLElement | null | undefined;
  readonly reviewPanel: HTMLElement | null | undefined;
  readonly submitButton: HTMLButtonElement | null | undefined;
};

const renderNftTransferReview = (
  elements: NftReviewElements,
  review: TransferReviewResponse["review"],
  key: string,
  setReviewedKey: (value: string | null) => void,
  setRequiresDeployment: (value: boolean) => void,
): void => {
  const { form, result, reviewPanel, submitButton } = elements;
  const feeFailed = review.feeEstimateFailed;
  const recipientBlocked = review.flags.some((flag) => flag.code === "address-poisoning");
  setReviewedKey(feeFailed || recipientBlocked ? null : key);
  setRequiresDeployment(review.requiresDeployment);
  form.dataset["stage"] = recipientBlocked ? "blocked" : feeFailed ? "fee-failure" : "review";
  form.removeAttribute("aria-busy");
  if (reviewPanel) {
    renderFragment(reviewPanel, reviewPanelHtml(review));
  }
  submitButton?.lastChild?.replaceWith(
    feeFailed || recipientBlocked ? "Review transfer" : "Confirm transfer",
  );
  if (result) {
    result.textContent = recipientBlocked
      ? "This transfer is blocked. Change the recipient and review it again."
      : feeFailed
        ? "Fee estimate failed. Retry the fee estimate before sending."
        : "Review the details above, then confirm.";
  }
  reviewPanel
    ?.querySelector<HTMLButtonElement>("#review-retry-fee")
    ?.addEventListener("click", () => {
      form.requestSubmit();
    });
  buttonBusy(submitButton, feeFailed);
};

const bindAddForm = (deps: NftUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#nft-form");
  const result = deps.app?.querySelector<HTMLElement>("#nft-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    buttonBusy(submitButton, true);
    if (result) {
      result.textContent = "Checking ownership...";
    }
    void deps.wallet
      .addNft(
        normalizeFeltInput(String(data.get("contract") ?? "")),
        String(data.get("tokenId") ?? "").trim(),
        String(data.get("networkId") ?? ""),
        String(data.get("label") ?? "").trim(),
      )
      .then(
        async () => {
          showToast("NFT added", "success");
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Add NFT failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "Add NFT failed");
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

const bindSendForm = (deps: NftUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#nft-send-form");
  if (!form) {
    return;
  }
  const result = deps.app?.querySelector<HTMLElement>("#nft-send-result");
  const reviewPanel = deps.app?.querySelector<HTMLElement>("#nft-review-panel");
  const recipientInput = form.querySelector<HTMLInputElement>('input[name="recipient"]');
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
  let reviewedKey: string | null = null;
  let requiresDeployment = false;
  form.dataset["stage"] = "recipient";

  const resetReview = (): void => {
    reviewedKey = null;
    requiresDeployment = false;
    form.dataset["stage"] = "recipient";
    form.removeAttribute("aria-busy");
    recipientInput?.setCustomValidity("");
    if (reviewPanel) {
      renderFragment(reviewPanel, "");
    }
    submitButton?.lastChild?.replaceWith("Review transfer");
    buttonBusy(submitButton, false);
  };

  form.addEventListener("input", resetReview);
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-nft-recipient]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!recipientInput) {
        return;
      }
      recipientInput.value = button.dataset["nftRecipient"] ?? "";
      recipientInput.dispatchEvent(new Event("input", { bubbles: true }));
      recipientInput.focus();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const fields = {
      contract: normalizeFeltInput(String(data.get("contract") ?? "")),
      networkId: String(data.get("networkId") ?? ""),
      recipient: normalizeFeltInput(String(data.get("recipient") ?? "")),
      tokenId: String(data.get("tokenId") ?? ""),
    };
    const recipientError = recipientFieldError(fields.recipient);
    if (recipientError) {
      recipientInput?.setCustomValidity(recipientError);
      recipientInput?.reportValidity();
      if (result) {
        result.textContent = recipientError;
      }
      return;
    }

    const key = JSON.stringify(fields);
    buttonBusy(submitButton, true);

    if (reviewedKey !== key) {
      form.dataset["stage"] = "reviewing";
      form.setAttribute("aria-busy", "true");
      if (result) {
        result.textContent = "Checking ownership, recipient, transfer details, and fee…";
      }
      void deps.wallet
        .reviewNftTransfer(fields.contract, fields.tokenId, fields.networkId, fields.recipient)
        .then(
          (review) => {
            renderNftTransferReview(
              { form, result, reviewPanel, submitButton },
              review,
              key,
              (value) => {
                reviewedKey = value;
              },
              (value) => {
                requiresDeployment = value;
              },
            );
          },
          (error: unknown) => {
            const message = friendlyReviewError(error);
            form.dataset["stage"] = "failed";
            form.removeAttribute("aria-busy");
            showToast(message, "error");
            if (result) {
              result.textContent = message;
            }
            buttonBusy(submitButton, false);
          },
        );
      return;
    }

    form.dataset["stage"] = "submitting";
    form.setAttribute("aria-busy", "true");
    if (result) {
      result.textContent = "Authorizing and submitting the reviewed transfer…";
    }
    void deps.wallet
      .transferNft(fields.contract, fields.tokenId, fields.networkId, fields.recipient)
      .then(
        (transactionHash) => {
          showToast("NFT transfer submitted", "success");
          form.dataset["stage"] = "submitted";
          form.removeAttribute("aria-busy");
          if (reviewPanel) {
            renderFragment(
              reviewPanel,
              `<section class="nft-transfer-outcome" role="status">
                <span class="nft-transfer-mark">${icon("check")}</span>
                <div>
                  <strong>Submitted to Starknet</strong>
                  <p>The transfer is now visible in Activity while the network confirms it.</p>
                  <code>${escapeHtml(transactionHash)}</code>
                </div>
              </section>`,
            );
          }
          if (result) {
            result.textContent = "Transfer submitted. Confirmation is tracked in Activity.";
          }
          if (requiresDeployment) {
            void watchDeployment({ render: deps.render, wallet: deps.wallet });
          }
          if (submitButton) {
            submitButton.disabled = true;
          }
        },
        (error: unknown) => {
          const message = errorMessage(error, "NFT transfer failed");
          form.dataset["stage"] = "failed";
          form.removeAttribute("aria-busy");
          showToast(message, "error");
          if (result) {
            result.textContent = `${message} Nothing was submitted; review the recipient and try again.`;
          }
          buttonBusy(submitButton, false);
        },
      );
  });
};

// Swaps a gallery image back to the placeholder when it fails to load (or has
// already failed by the time listeners attach), so a broken or blocked metadata
// URL degrades gracefully instead of showing a broken-image glyph.
const bindImages = (deps: NftUiDeps): void => {
  deps.app?.querySelectorAll<HTMLImageElement>("img.nft-image").forEach((image) => {
    const markBroken = (): void => {
      image.classList.add("nft-image--broken");
    };
    image.addEventListener("error", markBroken);
    if (image.complete && image.naturalWidth === 0) {
      markBroken();
    }
  });
};

// Reveals a collectible's on-chain animation only on explicit user action. The
// untrusted data:text/html URI (carried on the play button) is handed to the
// manifest-sandboxed sandbox/render.html page through the iframe URL hash — never
// executed in the privileged side panel. render.html runs without privileged
// extension APIs or parent-DOM access under an egress-blocking CSP, so it cannot
// reach the vault or network.
const bindAnimation = (deps: NftUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-nft-play]").forEach((button) => {
    button.addEventListener("click", () => {
      const animationUrl = button.dataset["nftPlay"];
      const frame = button
        .closest(".nft-card, .collectible-tile, section")
        ?.querySelector<HTMLIFrameElement>("iframe.nft-animation");
      if (!animationUrl || !frame) {
        return;
      }
      frame.src = `sandbox/render.html#${encodeURIComponent(animationUrl)}`;
      frame.hidden = false;
      // setAttribute (not `button.hidden = …`) so we never assign to the loop
      // parameter's property; the play control collapses once it has fired.
      button.setAttribute("hidden", "");
    });
  });
};

// Hides an auto-discovered NFT as spam persistently: it is watched (re-proving
// ownership on-chain) and then flagged hidden, so it moves to the Hidden section
// and stays hidden across sessions like a manually watched spam NFT.
const bindHideDiscovered = (deps: NftUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-nft-hide]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["nftHide"];
      const contract = button.dataset["nftHideContract"];
      const tokenId = button.dataset["nftHideToken"];
      const networkId = button.dataset["nftHideNetwork"];
      const name = button.dataset["nftHideName"] ?? "";
      if (!id || !contract || !tokenId || !networkId) {
        return;
      }
      const label = name.length > 0 && name.length <= 64 ? name : "";
      buttonBusy(button, true);
      void deps.wallet
        .addNft(contract, tokenId, networkId, label)
        .then(() => deps.wallet.setNftSpam(id, true))
        .then(
          async () => {
            showToast("NFT hidden", "success");
            await rerender(deps);
          },
          (error: unknown) => {
            showToast(errorMessage(error, "NFT update failed"), "error");
            buttonBusy(button, false);
          },
        );
    });
  });
};

const bindRowActions = (deps: NftUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-nft-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["nftOpen"];
      if (id) {
        deps.openDetail(id);
      }
    });
  });

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-nft-spam]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["nftSpam"];
      if (!id) {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.setNftSpam(id, button.dataset["nftSpamValue"] === "true").then(
        async () => {
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "NFT update failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });

  deps.app?.querySelectorAll<HTMLButtonElement>("[data-remove-nft]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset["removeNft"];
      if (!id) {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.removeNft(id).then(
        async () => {
          showToast("NFT removed", "success");
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "NFT removal failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });
};

/**
 * Binds the NFT gallery add form, row actions, and detail send form.
 */
export const bindNfts = (deps: NftUiDeps): void => {
  bindAddForm(deps);
  bindSendForm(deps);
  bindRowActions(deps);
  bindHideDiscovered(deps);
  bindImages(deps);
  bindAnimation(deps);
};
