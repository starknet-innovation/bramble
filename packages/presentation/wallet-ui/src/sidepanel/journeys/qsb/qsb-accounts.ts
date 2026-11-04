/**
 * The Quantum-safe Bitcoin accounts screen, reached from the account drawer: a
 * static shell, then one row per account once `wallet.qsbAccounts` answers.
 * Each row states what the account can do now and opens the account's
 * address, balance and vaults; a phrase not yet backed up also carries Back up.
 *
 * Rows render through the audited fragment sink from the pure template below,
 * whose dynamic text is escaped and whose ids were validated by the client.
 */
import { escapeHtml } from "@bramble/core/html";
import { emptyState } from "@bramble/ui-kit/content";
import { button } from "@bramble/ui-kit/controls";
import { menuRow } from "@bramble/ui-kit/navigation";
import type { QsbAccountView } from "@bramble/wallet-model/qsb";
import type { WalletStatus } from "../../../popup/responses/responses";
import { errorLine, renderFragment } from "../../shared/dom";
import { flowHeader, flowScreen } from "../../shared/parts";
import {
  QSB_EMPTY,
  QSB_HISTORY_UNAVAILABLE_HINT,
  QSB_LOADING,
  QSB_STATE_LABEL,
  QSB_TITLE,
  qsbAccountLabel,
  qsbAccountState,
} from "./qsb-model";
import type { QsbWallet } from "./qsb-runtime";

/** Renders the screen shell; {@link bindQsbAccounts} fills the list. */
export const qsbAccountsFlow = (status: WalletStatus): string =>
  flowHeader(QSB_TITLE, status) +
  flowScreen(
    "qsb-accounts",
    `<section class="section">
      <div class="menu-list" role="group" aria-label="Add a quantum-safe Bitcoin account">
        ${menuRow({ attributes: { id: "qsb-create" }, icon: "plus", label: "Create account" })}
        ${menuRow({ attributes: { "data-view": "qsb-import" }, icon: "book", label: "Import phrase" })}
      </div>
    </section>
    <section class="section">
      <p class="eyebrow">Accounts</p>
      <div id="qsb-accounts-list">${emptyState(QSB_LOADING, "status")}</div>
    </section>`,
  );

const accountRow = (account: QsbAccountView): string => {
  const state = qsbAccountState(account);
  const name = qsbAccountLabel(account.id);
  return `<li class="allowance-row" data-qsb-account="${escapeHtml(account.id)}">
    ${menuRow({
      attributes: { "data-qsb-open": account.id },
      icon: "lockKeyhole",
      label: name,
      supportingText:
        state === "history-unavailable"
          ? `${QSB_STATE_LABEL[state]} · ${QSB_HISTORY_UNAVAILABLE_HINT}`
          : QSB_STATE_LABEL[state],
    })}
    ${
      state === "backup-needed"
        ? button({
            attributes: { "aria-label": `Back up ${name}`, "data-qsb-back-up": account.id },
            label: "Back up",
            size: "small",
            variant: "secondary",
          })
        : ""
    }
  </li>`;
};

/** The list body for `accounts`: the empty state, or one row each. */
export const qsbAccountRows = (accounts: readonly QsbAccountView[]): string =>
  accounts.length === 0
    ? emptyState(QSB_EMPTY)
    : `<ul class="allowance-list">${accounts.map(accountRow).join("")}</ul>`;

/** What the list binding needs: the client, and where each action leads. */
export type QsbAccountsDeps = {
  readonly create: () => void;
  readonly list: HTMLElement;
  readonly openAccount: (accountId: string) => void;
  readonly openBackup: (accountId: string) => void;
  readonly root: Element;
  readonly wallet: Pick<QsbWallet, "loadQsbAccounts">;
};

/**
 * Loads the accounts into `list` and wires Create, each row and each Back up. A failed
 * read shows its reviewed line in place of the rows; nothing is retried
 * behind the user's back.
 */
export const bindQsbAccounts = ({
  create,
  list,
  openAccount,
  openBackup,
  root,
  wallet,
}: QsbAccountsDeps): void => {
  root.querySelector<HTMLButtonElement>("#qsb-create")?.addEventListener("click", create);
  void wallet.loadQsbAccounts().then(
    (accounts) => {
      renderFragment(list, qsbAccountRows(accounts));
      for (const control of list.querySelectorAll<HTMLButtonElement>("[data-qsb-open]")) {
        const id = control.dataset["qsbOpen"];
        if (id) control.addEventListener("click", () => openAccount(id));
      }
      for (const control of list.querySelectorAll<HTMLButtonElement>("[data-qsb-back-up]")) {
        const id = control.dataset["qsbBackUp"];
        if (id) control.addEventListener("click", () => openBackup(id));
      }
    },
    (error: unknown) => {
      renderFragment(list, emptyState(errorLine(error, "wallet unavailable"), "alert"));
    },
  );
};
