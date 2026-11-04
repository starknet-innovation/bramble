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
  title: "Wallet journeys/13 Quantum-safe Bitcoin vaults",
};

export default meta;

const account = (name: string, id: string) => checkpointStory(name, "qsb-vaults", id);
const deposit = (name: string, id: string) => checkpointStory(name, "qsb-deposit", id);

export const Account = account("Account · every vault state", "qsb-account");
export const AccountEmpty = account("Account · no vaults", "qsb-account-empty");
export const AccountOffline = account("Account · service out of reach", "qsb-account-offline");
export const AccountAccess = account("Account · access not granted", "qsb-account-access");
export const AccountAccessDenied = account("Account · access denied", "qsb-account-access-denied");
export const AccountError = account("Account · read failed", "qsb-account-error");
export const AccountReadOnly = account("Account · imported phrase", "qsb-account-read-only");
export const AccountBackupNeeded = account("Account · backup needed", "qsb-account-backup-needed");
export const AccountResent = account("Account · resent", "qsb-account-resent");
export const VaultConfirm = account("New vault · confirm", "qsb-vault-confirm");
export const VaultCreating = account("New vault · creating", "qsb-vault-creating");
export const VaultCreated = account("New vault · created", "qsb-vault-created");
export const VaultRefused = account("New vault · refused", "qsb-vault-refused");

export const DepositAmount = deposit("Deposit · amount", "qsb-deposit-amount");
export const DepositAmountRefused = deposit(
  "Deposit · over the balance",
  "qsb-deposit-amount-refused",
);
export const DepositReview = deposit("Deposit · review", "qsb-deposit-review");
export const DepositAccepted = deposit("Deposit · costs accepted", "qsb-deposit-accepted");
export const DepositSending = deposit("Deposit · sending", "qsb-deposit-sending");
export const DepositSent = deposit("Deposit · sent", "qsb-deposit-sent");
export const DepositUncertain = deposit("Deposit · not confirmed yet", "qsb-deposit-uncertain");
export const DepositRejected = deposit("Deposit · refused", "qsb-deposit-rejected");
export const DepositQuoteChanged = deposit("Deposit · cost changed", "qsb-deposit-quote-changed");
export const DepositUnknown = deposit("Deposit · status unknown", "qsb-deposit-unknown");
export const DepositOffline = deposit("Deposit · service out of reach", "qsb-deposit-offline");
export const DepositResent = deposit("Deposit · resent", "qsb-deposit-resend");
export const DepositAccess = deposit("Deposit · access not granted", "qsb-deposit-access");

// The narrowest side panel: the full address, every amount and the review's
// rows must stay inside the panel and readable.
export const AccountNarrow = narrowSidepanelStory("Account · 320px", "qsb-vaults", "qsb-account", [
  (document) => assertValueFits(document, "#qsb-address"),
  (document) => assertValueFits(document, "#qsb-balance .receipt-row dd"),
  (document) => assertInsidePanel(document, "[data-qsb-vault]"),
  (document) => assertInsidePanel(document, "[data-qsb-tx]"),
]);
export const AccountAccessNarrow = narrowSidepanelStory(
  "Account · access not granted · 320px",
  "qsb-vaults",
  "qsb-account-access",
  [
    (document) => assertValueFits(document, "#qsb-balance [role='status']"),
    (document) => assertInsidePanel(document, "[data-qsb-allow]"),
  ],
);
export const DepositAccessNarrow = narrowSidepanelStory(
  "Deposit · access not granted · 320px",
  "qsb-deposit",
  "qsb-deposit-access",
  [
    (document) => assertValueFits(document, "#qsb-deposit-error"),
    (document) => assertInsidePanel(document, "#qsb-deposit-allow"),
  ],
);
export const VaultConfirmNarrow = narrowSidepanelStory(
  "New vault · 320px",
  "qsb-vaults",
  "qsb-vault-confirm",
);
export const DepositAmountNarrow = narrowSidepanelStory(
  "Deposit amount · 320px",
  "qsb-deposit",
  "qsb-deposit-amount-refused",
  [(document) => assertValueFits(document, "#qsb-amount-available")],
);
export const DepositReviewNarrow = narrowSidepanelStory(
  "Deposit review · 320px",
  "qsb-deposit",
  "qsb-deposit-accepted",
  [(document) => assertValueFits(document, "#qsb-deposit-quote .receipt-row dd")],
);
export const DepositSentNarrow = narrowSidepanelStory(
  "Deposit sent · 320px",
  "qsb-deposit",
  "qsb-deposit-sent",
  [(document) => assertInsidePanel(document, "#qsb-outcome-tx")],
);
