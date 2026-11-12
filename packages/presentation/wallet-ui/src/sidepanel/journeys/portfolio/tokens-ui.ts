/**
 * Bindings for the tokens flow and token detail navigation: add a custom
 * token, auto-detect held tokens with one-tap add, hide, reveal or remove
 * tracked tokens, and open a token's detail screen from a balance row.
 */

import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { normalizeFeltInput } from "@bramble/wallet-model/networks";
import { t } from "../../../i18n/messages";
import type { TokenBalance, WalletStatus } from "../../../popup/responses/responses";
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
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
    ? emptyState(t("portfolio.tokenDiscover.noneInAccount"))
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
              label: t("portfolio.tokens.add"),
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
        showToast(t("portfolio.tokens.added"), "success", form);
        await rerender(deps);
      },
      (error: unknown) => {
        showToast(errorDetails(error, t("portfolio.tokens.addFailed")), "error", form);
        if (result) {
          result.textContent = errorLine(error, t("portfolio.tokens.addFailed"));
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
          showToast(t("portfolio.tokens.added"), "success", button);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorDetails(error, t("portfolio.tokens.addFailed")), "error", button);
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
            suggestions.length === 0
              ? t("portfolio.tokenDiscover.none")
              : t("portfolio.tokenDiscover.found", { count: String(suggestions.length) });
        }
        buttonBusy(button, false);
      },
      (error: unknown) => {
        showToast(errorDetails(error, t("portfolio.tokenDiscover.failed")), "error", button);
        if (status) {
          status.textContent = errorLine(error, t("portfolio.tokenDiscover.failed"));
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
          showToast(
            hidden ? t("portfolio.tokens.shown") : t("portfolio.tokens.hidden"),
            "success",
            button,
          );
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorDetails(error, t("portfolio.tokens.updateFailed")), "error", button);
          buttonBusy(button, false);
        },
      );
    });
  });
};

// Removal is the way out of a token a dapp added (Sherlock audit 134); the
// background refuses built-in tokens even if a stale row offers the control.
const bindRemove = (deps: TokensUiDeps): void => {
  deps.app?.querySelectorAll<HTMLButtonElement>("[data-token-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const tokenId = button.dataset["tokenRemove"];
      if (!tokenId) {
        return;
      }
      buttonBusy(button, true);
      void deps.wallet.removeToken(tokenId).then(
        async () => {
          showToast(t("portfolio.tokens.removed"), "success", deps.app);
          await rerender(deps);
        },
        (error: unknown) => {
          showToast(errorDetails(error, t("portfolio.tokens.removeFailed")), "error", deps.app);
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
  bindRemove(deps);
  bindOpenDetail(deps);
};
