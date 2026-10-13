/**
 * Bindings for the Shadow accounts screen (issue 443, PR 5). Lists the recorded
 * scopes on open (vault only), reads one scope's shadow accounts and balances
 * only when the user taps, and builds, reviews, and confirms a sweep. Every
 * value is written through `textContent`; nothing here is an HTML sink.
 */
import type { SidepanelWallet } from "../../runtime/runtime";
import { buttonBusy, errorDetails, errorLine, showToast } from "../../shared/dom";
import {
  SHADOW_ACCOUNTS_CHECK,
  SHADOW_ACCOUNTS_CONFIRM_SWEEP,
  SHADOW_ACCOUNTS_EMPTY,
  SHADOW_ACCOUNTS_NOTHING_HELD,
  SHADOW_ACCOUNTS_OTHER_ANONYMIZER,
  SHADOW_ACCOUNTS_SWEEP,
  SHADOW_ACCOUNTS_SWEEP_SENT,
  SHADOW_ACCOUNTS_UNDEPLOYED,
  SHADOW_ACCOUNTS_UNLISTED,
} from "./shadow-accounts-copy";
import type { ShadowAccountView, ShadowScopeView } from "./shadow-accounts-runtime";

type ShadowWallet = Pick<
  SidepanelWallet,
  | "executePrivacyPreparation"
  | "loadShadowAccountBalances"
  | "loadShadowAccounts"
  | "prepareShadowSweep"
>;

// The screen's own document, never a global: this module is not an entrypoint.
let doc: Document | null = null;

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] => {
  if (!doc) throw new Error("shadow accounts screen is not bound");
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const control = (label: string): HTMLButtonElement => {
  const node = element("button", label, "secondary small");
  node.type = "button";
  return node;
};

const nonceLabel = (nonce: string): string => `#${BigInt(nonce).toString()}`;

// Review, then confirm: the sweep's background-built summaries are the review.
const bindSweep = (
  wallet: ShadowWallet,
  scope: ShadowScopeView,
  account: ShadowAccountView,
  row: HTMLElement,
): void => {
  const sweep = control(SHADOW_ACCOUNTS_SWEEP);
  row.append(sweep);
  sweep.addEventListener("click", () => {
    buttonBusy(sweep, true);
    void wallet.prepareShadowSweep(scope.origin, scope.label, account.nonce).then(
      (preparation) => {
        const review = element("ul", undefined, "review-calls");
        for (const summary of preparation.summaries) review.append(element("li", summary));
        const confirm = control(SHADOW_ACCOUNTS_CONFIRM_SWEEP);
        sweep.replaceWith(review, confirm);
        confirm.addEventListener("click", () => {
          buttonBusy(confirm, true);
          void wallet.executePrivacyPreparation(preparation.id).then(
            () => {
              confirm.replaceWith(element("p", SHADOW_ACCOUNTS_SWEEP_SENT, "hint"));
              showToast(SHADOW_ACCOUNTS_SWEEP_SENT, "success", row);
            },
            (error: unknown) => {
              buttonBusy(confirm, false);
              showToast(errorDetails(error, "Private transaction failed"), "error", confirm);
            },
          );
        });
      },
      (error: unknown) => {
        buttonBusy(sweep, false);
        showToast(errorDetails(error, "shadow_account_sweep_unavailable"), "error", sweep);
      },
    );
  });
};

const accountRow = (
  wallet: ShadowWallet,
  scope: ShadowScopeView,
  account: ShadowAccountView,
): HTMLElement => {
  const row = element("li", undefined, "shadow-account-row");
  const head = element("p");
  head.append(element("strong", nonceLabel(account.nonce)), " ", element("code", account.address));
  if (!account.deployed) head.append(" · ", SHADOW_ACCOUNTS_UNDEPLOYED);
  row.append(head);
  row.append(
    element(
      "p",
      account.balances.length === 0
        ? SHADOW_ACCOUNTS_NOTHING_HELD
        : account.balances.map((balance) => `${balance.formatted} ${balance.symbol}`).join(", "),
      "hint",
    ),
  );
  if (account.balances.length > 0) bindSweep(wallet, scope, account, row);
  return row;
};

const scopeCard = (wallet: ShadowWallet, scope: ShadowScopeView): HTMLElement => {
  const card = element("li", undefined, "shadow-scope");
  card.append(element("strong", scope.origin), element("p", scope.label, "hint"));
  if (!scope.current) {
    card.append(element("p", SHADOW_ACCOUNTS_OTHER_ANONYMIZER(scope.anonymizer), "hint"));
    return card;
  }
  const check = control(SHADOW_ACCOUNTS_CHECK);
  const results = element("div");
  card.append(check, results);
  check.addEventListener("click", () => {
    buttonBusy(check, true);
    void wallet.loadShadowAccountBalances(scope.origin, scope.label).then(
      ({ accounts, unlisted }) => {
        buttonBusy(check, false);
        const list = element("ul");
        for (const account of accounts) list.append(accountRow(wallet, scope, account));
        results.replaceChildren(list);
        if (unlisted.length > 0) {
          results.append(
            element(
              "p",
              SHADOW_ACCOUNTS_UNLISTED(
                unlisted.map((nonce) => BigInt(nonce).toString()).join(", #"),
              ),
              "hint",
            ),
          );
        }
      },
      (error: unknown) => {
        buttonBusy(check, false);
        results.replaceChildren(
          element("p", errorLine(error, "shadow_account_balances_unavailable"), "hint"),
        );
      },
    );
  });
  return card;
};

/**
 * Fills the Shadow accounts screen when it is on screen. Reads only the vault
 * records; every network read waits for the user's tap.
 */
export const bindShadowAccounts = ({
  app,
  wallet,
}: {
  readonly app: Element | null;
  readonly wallet: ShadowWallet;
}): void => {
  const list = app?.querySelector<HTMLElement>("#shadow-accounts-list");
  if (!list) return;
  doc = list.ownerDocument;
  void wallet.loadShadowAccounts().then(
    (scopes) => {
      if (scopes.length === 0) {
        list.replaceChildren(element("p", SHADOW_ACCOUNTS_EMPTY, "empty-state"));
        return;
      }
      const cards = element("ul", undefined, "shadow-scopes");
      for (const scope of scopes) cards.append(scopeCard(wallet, scope));
      list.replaceChildren(cards);
    },
    (error: unknown) => {
      list.replaceChildren(
        element("p", errorLine(error, "shadow_accounts_unavailable"), "empty-state"),
      );
    },
  );
};
