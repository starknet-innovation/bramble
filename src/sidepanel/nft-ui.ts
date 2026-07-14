/**
 * NFT gallery bindings: add a watched NFT after on-chain ownership is proven,
 * open a collectible's detail screen, toggle spam-hide, remove, and send
 * through the verified invoke path.
 */
import type { WalletStatus } from "../popup/responses";
import { normalizeFeltInput } from "../starknet/networks";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";

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
  const result = deps.app?.querySelector<HTMLElement>("#nft-send-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    buttonBusy(submitButton, true);
    void deps.wallet
      .transferNft(
        normalizeFeltInput(String(data.get("contract") ?? "")),
        String(data.get("tokenId") ?? ""),
        String(data.get("networkId") ?? ""),
        normalizeFeltInput(String(data.get("recipient") ?? "")),
      )
      .then(
        (transactionHash) => {
          showToast("NFT transfer submitted", "success");
          if (result) {
            result.textContent = `Submitted ${transactionHash}`;
          }
          form.reset();
          buttonBusy(submitButton, false);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "NFT transfer failed"), "error");
          if (result) {
            result.textContent = errorMessage(error, "NFT transfer failed");
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
};
