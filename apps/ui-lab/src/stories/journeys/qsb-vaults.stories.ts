import {
  assertInsidePanel,
  assertValueFits,
  checkpointStory,
  LAB_META,
  type LabMeta,
  narrowSidepanelStory,
} from "../../runtime/story-helpers";

const meta: LabMeta = {
  ...LAB_META,
  args: { checkpointId: "qsb-account", scenarioId: "qsb-vaults" },
  title: "Wallet journeys/13 QSB deposits",
};

export default meta;

const account = (name: string, id: string) => checkpointStory(name, "qsb-vaults", id);
const deposit = (name: string, id: string) => checkpointStory(name, "qsb-deposit", id);

export const Account = account("QSB vault · every deposit state", "qsb-account");
export const AccountEmpty = account("QSB vault · no deposits", "qsb-account-empty");
export const AccountOffline = account("QSB vault · service out of reach", "qsb-account-offline");
export const AccountAccess = account("QSB vault · access not granted", "qsb-account-access");
export const AccountAccessDenied = account(
  "QSB vault · access denied",
  "qsb-account-access-denied",
);
export const AccountError = account("QSB vault · read failed", "qsb-account-error");
export const AccountReadOnly = account("QSB vault · imported phrase", "qsb-account-read-only");
export const AccountBackupNeeded = account(
  "QSB vault · backup needed",
  "qsb-account-backup-needed",
);
export const AccountResent = account("QSB vault · resent", "qsb-account-resent");
export const VaultConfirm = account("New deposit · confirm", "qsb-vault-confirm");
export const VaultCreating = account("New deposit · creating", "qsb-vault-creating");
export const VaultCreated = account("New deposit · created", "qsb-vault-created");
export const VaultRefused = account("New deposit · refused", "qsb-vault-refused");

export const DepositAmount = deposit("Fund · amount", "qsb-deposit-amount");
export const DepositAmountRefused = deposit(
  "Fund · over the balance",
  "qsb-deposit-amount-refused",
);
export const DepositReview = deposit("Fund · review", "qsb-deposit-review");
export const DepositAccepted = deposit("Fund · costs accepted", "qsb-deposit-accepted");
export const DepositSending = deposit("Fund · sending", "qsb-deposit-sending");
export const DepositSent = deposit("Fund · sent", "qsb-deposit-sent");
export const DepositUncertain = deposit("Fund · not confirmed yet", "qsb-deposit-uncertain");
export const DepositRejected = deposit("Fund · refused", "qsb-deposit-rejected");
export const DepositQuoteChanged = deposit("Fund · cost changed", "qsb-deposit-quote-changed");
export const DepositUnknown = deposit("Fund · status unknown", "qsb-deposit-unknown");
export const DepositOffline = deposit("Fund · service out of reach", "qsb-deposit-offline");
export const DepositResent = deposit("Fund · resent", "qsb-deposit-resend");
export const DepositAccess = deposit("Fund · access not granted", "qsb-deposit-access");

// The narrowest side panel: the full address, every amount and the review's
// rows must stay inside the panel and readable.
export const AccountNarrow = narrowSidepanelStory(
  "QSB vault · 320px",
  "qsb-vaults",
  "qsb-account",
  [
    (document) => assertValueFits(document, "#qsb-address"),
    (document) => assertValueFits(document, "#qsb-balance .receipt-row dd"),
    (document) => assertInsidePanel(document, "[data-qsb-vault]"),
    (document) => assertInsidePanel(document, "[data-qsb-tx]"),
  ],
);
export const AccountAccessNarrow = narrowSidepanelStory(
  "QSB vault · access not granted · 320px",
  "qsb-vaults",
  "qsb-account-access",
  [
    (document) => assertValueFits(document, "#qsb-balance [role='status']"),
    (document) => assertInsidePanel(document, "[data-qsb-allow]"),
  ],
);
export const DepositAccessNarrow = narrowSidepanelStory(
  "Fund · access not granted · 320px",
  "qsb-deposit",
  "qsb-deposit-access",
  [
    (document) => assertValueFits(document, "#qsb-deposit-error"),
    (document) => assertInsidePanel(document, "#qsb-deposit-allow"),
  ],
);
export const VaultConfirmNarrow = narrowSidepanelStory(
  "New deposit · 320px",
  "qsb-vaults",
  "qsb-vault-confirm",
);
export const DepositAmountNarrow = narrowSidepanelStory(
  "Fund amount · 320px",
  "qsb-deposit",
  "qsb-deposit-amount-refused",
  [(document) => assertValueFits(document, "#qsb-amount-available")],
);
export const DepositReviewNarrow = narrowSidepanelStory(
  "Fund review · 320px",
  "qsb-deposit",
  "qsb-deposit-accepted",
  [(document) => assertValueFits(document, "#qsb-deposit-quote .receipt-row dd")],
);
export const DepositSentNarrow = narrowSidepanelStory(
  "Fund sent · 320px",
  "qsb-deposit",
  "qsb-deposit-sent",
  [(document) => assertInsidePanel(document, "#qsb-outcome-tx")],
);
