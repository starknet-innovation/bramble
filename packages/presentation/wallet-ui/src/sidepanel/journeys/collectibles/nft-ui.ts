/**
 * NFT gallery bindings: add a watched NFT after on-chain ownership is proven,
 * open a collectible's detail screen, toggle spam-hide, remove, and send
 * through the verified invoke path.
 */

import { normalizeFeltInput } from "@bramble/wallet-model/networks";
import type { TransferReviewResponse, WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { awaitConfirmation, type ConfirmationOutcome } from "../../shared/confirm-submitted";
import { buttonBusy, errorMessage, renderFragment, showToast } from "../../shared/dom";
import {
  outcomeReceiptActions,
  outcomeReceiptFor,
  outcomeReceiptSection,
  paintOutcomeReceipt,
} from "../../shared/outcome-receipt";
import { reviewFeeBlocked } from "../../shared/review-render";
import { watchDeployment } from "../../shell/shell-bindings";
import { friendlyReviewError, recipientFieldError, reviewPanelHtml } from "../send/transfer-ui";

/**
 * Dependencies the NFT bindings close over. `openDetail` navigates to the NFT
 * detail screen for the given watched-NFT id.
 */
export type NftUiDeps = {
  readonly app: Element | null;
  /** Overrides the confirmation checkpoints; tests pass a single zero delay. */
  readonly confirmationDelaysMs?: readonly number[];
  /** Leaves the transfer for a dock screen from its receipt. */
  readonly navigate?: (view: "activity") => void;
  readonly openDetail: (id: string) => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

// A transfer has nothing to itemise beyond the review above it, so the receipt
// states the outcome, says once where the token went, and shows the hash.
const paintNftReceipt = async (
  deps: NftUiDeps,
  root: ParentNode | null | undefined,
  outcome: ConfirmationOutcome | null,
  hash: string,
): Promise<void> => {
  const status = await deps.wallet.loadStatus();
  if (!root) return;
  paintOutcomeReceipt(
    root,
    "nft-success",
    outcomeReceiptFor(
      outcome,
      {
        confirmedDescription: "The collectible is now held by the recipient.",
        confirmedTitle: "Transfer complete",
        submittedTitle: "Transfer submitted",
      },
      hash,
    ),
    status.networkId,
  );
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
  setReviewedFees: (
    fee: TransferReviewResponse["review"]["fee"],
    deploymentFee: TransferReviewResponse["review"]["deploymentFee"],
  ) => void,
): void => {
  const { form, result, reviewPanel, submitButton } = elements;
  const feeFailed = reviewFeeBlocked(review);
  const recipientBlocked = review.flags.some((flag) => flag.code === "address-poisoning");
  setReviewedKey(feeFailed || recipientBlocked ? null : key);
  setRequiresDeployment(review.requiresDeployment);
  // Kept so the send can echo back the exact figure this panel rendered; the
  // background refuses a send whose fee has outrun it (MCW-V09-119).
  setReviewedFees(review.fee, review.deploymentFee);
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
        ? "Couldn't estimate the fee. Retry before sending."
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
          showToast("Collectible added", "success", deps.app);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Couldn't add that collectible"), "error", deps.app);
          if (result) {
            result.textContent = errorMessage(error, "Couldn't add that collectible");
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
  let reviewedFee: TransferReviewResponse["review"]["fee"] = null;
  let reviewedDeploymentFee: TransferReviewResponse["review"]["deploymentFee"] = null;
  form.dataset["stage"] = "recipient";

  const resetReview = (): void => {
    reviewedKey = null;
    requiresDeployment = false;
    reviewedFee = null;
    reviewedDeploymentFee = null;
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
      accountId: String(data.get("accountId") ?? ""),
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
        result.textContent = "Checking the transfer…";
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
              (fee, deploymentFee) => {
                reviewedFee = fee;
                reviewedDeploymentFee = deploymentFee;
              },
            );
          },
          (error: unknown) => {
            const message = friendlyReviewError(error);
            form.dataset["stage"] = "failed";
            form.removeAttribute("aria-busy");
            showToast(message, "error", deps.app);
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
      result.textContent = "Submitting…";
    }
    void deps.wallet
      .transferNft(
        fields.contract,
        fields.tokenId,
        fields.networkId,
        fields.recipient,
        reviewedFee,
        reviewedDeploymentFee,
      )
      .then(
        async (transactionHash) => {
          showToast("Transfer submitted", "success", deps.app);
          form.dataset["stage"] = "submitted";
          form.removeAttribute("aria-busy");
          if (reviewPanel) {
            renderFragment(
              reviewPanel,
              outcomeReceiptSection("nft-success", outcomeReceiptActions("nft-view-activity")),
            );
            reviewPanel.querySelector("#nft-success")?.removeAttribute("hidden");
            reviewPanel
              .querySelector("#nft-view-activity")
              ?.addEventListener("click", () => deps.navigate?.("activity"));
          }
          if (result) {
            result.textContent = "";
          }
          // Submitted is not delivered. The receipt opens on what is certain
          // and firms up once the chain reports the transfer.
          await paintNftReceipt(deps, reviewPanel, null, transactionHash);
          void awaitConfirmation({
            ...(deps.confirmationDelaysMs ? { delaysMs: deps.confirmationDelaysMs } : {}),
            hash: transactionHash,
            loadActivity: () => deps.wallet.loadActivity(),
            stillCurrent: () => form.isConnected,
          }).then((outcome) => paintNftReceipt(deps, reviewPanel, outcome, transactionHash));
          if (requiresDeployment) {
            void watchDeployment(
              { render: deps.render, wallet: deps.wallet },
              {
                accountId: fields.accountId,
                stillCurrent: () =>
                  form.isConnected && new FormData(form).get("accountId") === fields.accountId,
              },
            );
          }
          if (submitButton) {
            submitButton.disabled = true;
          }
        },
        (error: unknown) => {
          const message = errorMessage(error, "The transfer didn't go through");
          form.dataset["stage"] = "failed";
          form.removeAttribute("aria-busy");
          showToast(message, "error", deps.app);
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
        .closest(".nft-card, section")
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
            showToast("Collectible hidden", "success", deps.app);
            await rerender(deps);
          },
          (error: unknown) => {
            showToast(errorMessage(error, "Couldn't update that collectible"), "error", deps.app);
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
          showToast(errorMessage(error, "Couldn't update that collectible"), "error", deps.app);
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
          showToast("Collectible removed", "success", deps.app);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Couldn't remove that collectible"), "error", deps.app);
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
