/**
 * NFT gallery bindings: add a watched NFT after on-chain ownership is proven,
 * open a collectible's detail screen, show a discovered NFT's art by watching
 * it, toggle spam-hide, and remove. The detail
 * screen's send journey lives in ./nft-send-ui.
 */

import { normalizeFeltInput } from "@bramble/wallet-model/networks";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
import { confirmSecondTap } from "../../shared/two-tap-confirm";
import { bindNftSendForm, type NftSendDeps } from "./nft-send-ui";

/**
 * Dependencies the NFT bindings close over: the send journey's, plus
 * `openDetail`, which navigates to the NFT detail screen for the given
 * watched-NFT id.
 */
export type NftUiDeps = NftSendDeps & {
  readonly openDetail: (id: string) => void;
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
          showToast("NFT added", "success", deps.app);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Couldn't add that NFT"), "error", deps.app);
          if (result) {
            result.textContent = errorLine(error, "Couldn't add that NFT");
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

// A discovered-only card's target, read from the `data-nft-<action>-*`
// attributes nft-card-actions writes. The background re-validates every field
// and re-proves ownership, so these are only a request, never evidence.
type DiscoveredTarget = {
  readonly contract: string;
  readonly id: string;
  readonly label: string;
  readonly networkId: string;
  readonly tokenId: string;
};

const discoveredTarget = (
  button: HTMLButtonElement,
  action: "Hide" | "Show",
): DiscoveredTarget | null => {
  const id = button.dataset[`nft${action}`];
  const contract = button.dataset[`nft${action}Contract`];
  const tokenId = button.dataset[`nft${action}Token`];
  const networkId = button.dataset[`nft${action}Network`];
  const name = button.dataset[`nft${action}Name`] ?? "";
  if (!id || !contract || !tokenId || !networkId) {
    return null;
  }
  const label = name.length > 0 && name.length <= 64 ? name : "";
  return { contract, id, label, networkId, tokenId };
};

const watchDiscovered = (deps: NftUiDeps, target: DiscoveredTarget): Promise<void> =>
  deps.wallet.addNft(target.contract, target.tokenId, target.networkId, target.label);

// Hides an auto-discovered NFT as spam persistently: it is watched (re-proving
// ownership on-chain) and then flagged hidden, so it moves to the Hidden section
// and stays hidden across sessions like a manually watched spam NFT.
const bindHideDiscovered = (deps: NftUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-nft-hide]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = discoveredTarget(button, "Hide");
      if (!target) {
        return;
      }
      buttonBusy(button, true);
      void watchDiscovered(deps, target)
        .then(() => deps.wallet.setNftSpam(target.id, true))
        .then(
          async () => {
            showToast("NFT hidden", "success", deps.app);
            await rerender(deps);
          },
          (error: unknown) => {
            showToast(errorDetails(error, "Couldn't update that NFT"), "error", deps.app);
            buttonBusy(button, false);
          },
        );
    });
  });
};

// Shows a discovered-only NFT's art by watching it through the same path as
// Hide and the watch form (the background re-proves ownership on chain). Only
// a watched NFT has its metadata and image read, so this click is the user's
// choice to contact the NFT's own links; the re-render then shows it as
// watched (Hide and Remove) and the watched lane fetches its art.
const bindShowArt = (deps: NftUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-nft-show]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = discoveredTarget(button, "Show");
      if (!target) {
        return;
      }
      buttonBusy(button, true);
      void watchDiscovered(deps, target).then(
        async () => {
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Couldn't show the art"), "error", deps.app);
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
          showToast(errorDetails(error, "Couldn't update that NFT"), "error", deps.app);
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
      // Two taps, like deleting a folder: the first arms the control and says
      // so; only a second tap on the same control removes.
      // A text button shows the confirm label; an icon button keeps its icon
      // and carries the label as its accessible name.
      if (
        !confirmSecondTap(button, {
          label: "Tap again to remove",
          replaceContent: !button.classList.contains("icon-button"),
        })
      ) {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.removeNft(id).then(
        async () => {
          showToast("NFT removed", "success", deps.app);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorDetails(error, "Couldn't remove that NFT"), "error", deps.app);
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
  bindNftSendForm(deps);
  bindRowActions(deps);
  bindHideDiscovered(deps);
  bindShowArt(deps);
  bindImages(deps);
  bindAnimation(deps);
};
