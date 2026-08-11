/**
 * Bindings for the tokens flow and token detail navigation: add a custom
 * token, auto-detect held tokens with one-tap add, hide or reveal tracked
 * tokens, and open a token's detail screen from a balance row.
 */

import { escapeHtml } from "@mc-wallet/core/html";
import { emptyState } from "@mc-wallet/ui-kit/content";
import { button } from "@mc-wallet/ui-kit/controls";
import { normalizeFeltInput } from "@mc-wallet/wallet-model/networks";
import type { TokenBalance, WalletStatus } from "../popup/responses";
import { buttonBusy, errorMessage, showToast } from "./dom";
import type { SidepanelWallet } from "./runtime";
import { compactAmount, tokenGlyph } from "./token-row";

/**
 * Dependencies the token bindings close over.
 */
export type TokensUiDeps = {
  readonly app: Element | null;
  readonly openToken: (tokenId: string) => void;
  readonly refresh: () => Promise<WalletStatus>;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

const rerender = async (deps: TokensUiDeps): Promise<void> => {
  await deps.render(await deps.refresh());
};

const suggestionsHtml = (suggestions: readonly TokenBalance[]): string =>
  suggestions.length === 0
    ? emptyState("No new tokens found in this account.")
    : `<ul class="token-list">${suggestions
        .map(
          (token) => `<li class="token-row">
            ${tokenGlyph(token.address, token.symbol)}
            <div class="token-copy">
              <strong>${escapeHtml(token.symbol)}</strong>
              <p>${escapeHtml(compactAmount(token.formatted))} ${escapeHtml(token.symbol)}</p>
            </div>
            ${button({
              attributes: { "data-detect-add": token.address },
              label: "Add",
              size: "small",
              variant: "secondary",
            })}
          </li>`,
        )
        .join("")}</ul>`;

const bindAddToken = (deps: TokensUiDeps): void => {
  const form = deps.app?.querySelector<HTMLFormElement>("#token-add-form");
  const result = deps.app?.querySelector<HTMLElement>("#token-add-result");
  const submitButton = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const address = normalizeFeltInput(String(new FormData(form).get("address") ?? ""));
    buttonBusy(submitButton, true);
    void deps.wallet.addToken(address).then(
      async () => {
        showToast("Token added", "success");
        await rerender(deps);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Add token failed"), "error");
        if (result) {
          result.textContent = errorMessage(error, "Add token failed");
        }
        buttonBusy(submitButton, false);
      },
    );
  });
};

const bindDetectAdd = (deps: TokensUiDeps, container: Element | null | undefined): void => {
  container?.querySelectorAll<HTMLButtonElement>("[data-detect-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const address = button.dataset["detectAdd"];
      if (!address) {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.addToken(address).then(
        async () => {
          showToast("Token added", "success");
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Add token failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });
};

const bindDetect = (deps: TokensUiDeps): void => {
  const button = deps.app?.querySelector<HTMLButtonElement>("#detect-tokens");
  const results = deps.app?.querySelector<HTMLElement>("#detect-results");
  const status = deps.app?.querySelector<HTMLElement>("#detect-result");

  button?.addEventListener("click", () => {
    buttonBusy(button, true);
    void deps.wallet.detectTokens().then(
      (suggestions) => {
        if (results) {
          results.innerHTML = suggestionsHtml(suggestions);
        }
        bindDetectAdd(deps, results);
        if (status) {
          status.textContent =
            suggestions.length === 0 ? "No new tokens found." : `${suggestions.length} found.`;
        }
        buttonBusy(button, false);
      },
      (error: unknown) => {
        showToast(errorMessage(error, "Token detection failed"), "error");
        if (status) {
          status.textContent = errorMessage(error, "Token detection failed");
        }
        buttonBusy(button, false);
      },
    );
  });
};

const bindToggles = (deps: TokensUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-token-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const tokenId = button.dataset["tokenToggle"];
      if (!tokenId) {
        return;
      }
      const hidden = button.dataset["tokenHidden"] === "true";
      buttonBusy(button, true);
      void deps.wallet.setTokenHidden(tokenId, !hidden).then(
        async () => {
          showToast(hidden ? "Token shown" : "Token hidden", "success");
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorMessage(error, "Token update failed"), "error");
          buttonBusy(button, false);
        },
      );
    });
  });
};

const bindOpenDetail = (deps: TokensUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-token-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      const tokenId = button.dataset["tokenDetail"];
      if (tokenId) {
        deps.openToken(tokenId);
      }
    });
  });
};

/**
 * Binds every token-flow control plus balance-row detail navigation.
 */
export const bindTokens = (deps: TokensUiDeps): void => {
  bindAddToken(deps);
  bindDetect(deps);
  bindToggles(deps);
  bindOpenDetail(deps);
};
