/**
 * The QSB vaults screen, reached from the account drawer: a static shell, then
 * one row per QSB vault (a QSB account) once `wallet.qsbAccounts` answers.
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
import type { QsbAccess } from "./qsb-access";
import {
  QSB_EMPTY,
  QSB_LOADING,
  QSB_STATE_LABEL,
  QSB_TITLE,
  qsbAccountLabel,
  qsbAccountState,
} from "./qsb-model";
import type { QsbWallet } from "./qsb-runtime";
import type { QsbVaultWallet } from "./qsb-vault-runtime";
import { qsbReleaseWaiting } from "./qsb-withdrawal-model";

// A QSB vault row's line when one of its withdrawals waits on the user.
const QSB_RELEASE_WAITING = "Withdrawal ready to finish";

/** Renders the screen shell; {@link bindQsbAccounts} fills the list. */
export const qsbAccountsFlow = (status: WalletStatus): string =>
  flowHeader(QSB_TITLE, status) +
  flowScreen(
    "qsb-accounts",
    `<section class="section">
      <div class="menu-list" role="group" aria-label="Add a QSB vault">
        ${menuRow({ attributes: { id: "qsb-create" }, icon: "plus", label: "Create QSB vault" })}
        ${menuRow({ attributes: { "data-view": "qsb-import" }, icon: "book", label: "Import phrase" })}
      </div>
    </section>
    <section class="section">
      <div id="qsb-accounts-list">${emptyState(QSB_LOADING, "status")}</div>
    </section>`,
  );

const accountRow = (account: QsbAccountView, waiting: boolean): string => {
  const state = qsbAccountState(account);
  const name = qsbAccountLabel(account.id);
  return `<li class="allowance-row" data-qsb-account="${escapeHtml(account.id)}">
    ${menuRow({
      attributes: { "data-qsb-open": account.id },
      icon: "lockKeyhole",
      label: name,
      supportingText: waiting ? QSB_RELEASE_WAITING : QSB_STATE_LABEL[state],
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

/**
 * The list body for `accounts`: the empty state, or one row each. A row whose
 * id is in `waiting` says a withdrawal waits on the user instead of its state.
 */
export const qsbAccountRows = (
  accounts: readonly QsbAccountView[],
  waiting: ReadonlySet<string> = new Set(),
): string =>
  accounts.length === 0
    ? emptyState(QSB_EMPTY)
    : `<ul class="allowance-list">${accounts
        .map((account) => accountRow(account, waiting.has(account.id)))
        .join("")}</ul>`;

/** What the list binding needs: the client, and where each action leads. */
export type QsbAccountsDeps = {
  /** Checks the coordinator grant; the list never asks for it. */
  readonly access: Pick<QsbAccess, "check">;
  readonly create: () => void;
  readonly list: HTMLElement;
  readonly openAccount: (accountId: string) => void;
  readonly openBackup: (accountId: string) => void;
  readonly root: Element;
  readonly wallet: Pick<QsbWallet, "loadQsbAccounts"> & Pick<QsbVaultWallet, "loadQsbVaults">;
};

// The accounts with a withdrawal waiting on review, read only when the grant
// is already held (the list never prompts) and only for accounts that can
// hold deposits. A failed read leaves its row as it was.
const releaseWaiting = async (
  accounts: readonly QsbAccountView[],
  access: QsbAccountsDeps["access"],
  wallet: QsbAccountsDeps["wallet"],
): Promise<ReadonlySet<string>> => {
  if (!(await access.check())) return new Set();
  const usable = accounts.filter((account) => qsbAccountState(account) !== "backup-needed");
  const found = await Promise.all(
    usable.map((account) =>
      wallet.loadQsbVaults(account.id).then(
        (reading) => qsbReleaseWaiting(reading.vaults, account.writer),
        () => false,
      ),
    ),
  );
  return new Set(usable.filter((_, index) => found[index]).map((account) => account.id));
};

/**
 * Loads the accounts into `list` and wires Create, each row and each Back up. A failed
 * read shows its reviewed line in place of the rows; nothing is retried
 * behind the user's back. With the grant already held, each account's
 * deposits are then read once so a withdrawal waiting on the user shows on
 * its row.
 */
export const bindQsbAccounts = ({
  access,
  create,
  list,
  openAccount,
  openBackup,
  root,
  wallet,
}: QsbAccountsDeps): void => {
  root.querySelector<HTMLButtonElement>("#qsb-create")?.addEventListener("click", create);
  const render = (accounts: readonly QsbAccountView[], waiting?: ReadonlySet<string>): void => {
    renderFragment(list, qsbAccountRows(accounts, waiting));
    for (const control of list.querySelectorAll<HTMLButtonElement>("[data-qsb-open]")) {
      const id = control.dataset["qsbOpen"];
      if (id) control.addEventListener("click", () => openAccount(id));
    }
    for (const control of list.querySelectorAll<HTMLButtonElement>("[data-qsb-back-up]")) {
      const id = control.dataset["qsbBackUp"];
      if (id) control.addEventListener("click", () => openBackup(id));
    }
  };
  void wallet.loadQsbAccounts().then(
    (accounts) => {
      render(accounts);
      void releaseWaiting(accounts, access, wallet).then(
        (waiting) => {
          if (waiting.size > 0 && list.isConnected) render(accounts, waiting);
        },
        () => undefined,
      );
    },
    (error: unknown) => {
      renderFragment(list, emptyState(errorLine(error, "wallet unavailable"), "alert"));
    },
  );
};
