/**
 * The pure Quantum-safe Bitcoin vault model: BTC text from exact satoshi
 * arithmetic, typed BTC parsed to satoshis without floating point, the deposit
 * amount check, each vault state's label, the explorer link built only from a
 * validated txid, and the copy that reuses the background's reviewed
 * sentences.
 */
import { describe, expect, test } from "bun:test";
import {
  QSB_MAX_SAT,
  QSB_MIN_DEPOSIT_SAT,
  QSB_VAULT_REFUSALS,
} from "@bramble/wallet-model/qsb-vaults";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import {
  btcText,
  checkQsbDepositAmount,
  formatBtc,
  isQsbQuoteChanged,
  parseBtcAmount,
  QSB_AMOUNT_LINE,
  qsbDepositInFlight,
  qsbDepositLink,
  qsbNoVaultLine,
  qsbVaultDisplay,
  qsbVaultLabel,
  qsbVaultStatusText,
  qsbVaultWriteFailure,
} from "../../../../src/sidepanel/journeys/qsb/qsb-vault-model";
import { friendlyError } from "../../../../src/sidepanel/runtime/friendly-error";
import { QSB_VIEWS } from "../../../support/qsb-harness";
import {
  depositedVault,
  EVERY_VAULT,
  QSB_TXID,
  unfundedVault,
} from "../../../support/qsb-vault-fixtures";

describe("BTC amounts", () => {
  test("format with all 8 decimals from integers", () => {
    expect(formatBtc(0)).toBe("0.00000000");
    expect(formatBtc(1)).toBe("0.00000001");
    expect(formatBtc(120_000)).toBe("0.00120000");
    expect(formatBtc(100_000_000)).toBe("1.00000000");
    expect(formatBtc(QSB_MAX_SAT)).toBe("21000000.00000000");
    expect(formatBtc(QSB_MAX_SAT - 1)).toBe("20999999.99999999");
    expect(btcText(564)).toBe("0.00000564 BTC");
  });

  test("parse typed BTC exactly, up to 8 decimals and 21 million", () => {
    expect(parseBtcAmount("0.001")).toBe(100_000);
    expect(parseBtcAmount(" 1.5 ")).toBe(150_000_000);
    expect(parseBtcAmount("0.00000001")).toBe(1);
    expect(parseBtcAmount("0.1")).toBe(10_000_000);
    // 0.1 + 0.2 is the classic float trap; satoshis are exact.
    expect(parseBtcAmount("0.3")).toBe(30_000_000);
    expect(parseBtcAmount("20999999.99999999")).toBe(QSB_MAX_SAT - 1);
    expect(parseBtcAmount("21000000")).toBe(QSB_MAX_SAT);
    expect(parseBtcAmount("0")).toBe(0);
    for (const text of [
      "",
      "21000000.00000001",
      "0.000000001",
      "1e-3",
      "-0.1",
      "+0.1",
      ".5",
      "5.",
      "0,5",
      "01",
      "1 000",
      "Infinity",
      "0x10",
      "9".repeat(30),
    ]) {
      expect(parseBtcAmount(text)).toBe(null);
    }
  });

  test("a deposit amount is at least the minimum and at most the balance", () => {
    expect(checkQsbDepositAmount("0.0001", 250_000)).toEqual({
      kind: "ok",
      sat: QSB_MIN_DEPOSIT_SAT,
    });
    expect(checkQsbDepositAmount("0.0025", 250_000)).toEqual({ kind: "ok", sat: 250_000 });
    expect(checkQsbDepositAmount("0.00009999", 250_000).kind).toBe("tooSmall");
    expect(checkQsbDepositAmount("0", 250_000).kind).toBe("tooSmall");
    expect(checkQsbDepositAmount("0.00250001", 250_000).kind).toBe("tooLarge");
    expect(checkQsbDepositAmount("abc", 250_000).kind).toBe("invalid");
  });

  test("the refused amounts reuse the background's reviewed sentences", () => {
    expect(QSB_AMOUNT_LINE.tooSmall).toBe(friendlyError(QSB_VAULT_REFUSALS.amountTooSmall).message);
    expect(QSB_AMOUNT_LINE.tooLarge).toBe(
      friendlyError(QSB_VAULT_REFUSALS.insufficientFunds).message,
    );
    // The minimum in that sentence is the contract's own constant.
    const figure = /at least ([0-9.]+) BTC/.exec(QSB_AMOUNT_LINE.tooSmall)?.[1] ?? "";
    expect(parseBtcAmount(figure)).toBe(QSB_MIN_DEPOSIT_SAT);
  });
});

describe("vault rows", () => {
  test("each state has one label", () => {
    expect(EVERY_VAULT.map(qsbVaultStatusText)).toEqual([
      "Unfunded",
      "Deposit waiting",
      "Deposit sent",
      "Funded · 3 confirmations",
      "Withdrawn",
      "Unavailable",
    ]);
    expect(qsbVaultStatusText(depositedVault(0, "confirmed", 1))).toBe("Funded · 1 confirmation");
    expect(qsbVaultStatusText(depositedVault(0, "confirmed", null))).toBe("Funded");
  });

  test("a retired key set reads as withdrawn only when it was funded", () => {
    expect(qsbVaultDisplay({ ...depositedVault(0, "confirmed"), state: "retired" })).toBe(
      "withdrawn",
    );
    expect(qsbVaultDisplay({ ...unfundedVault(0), state: "retired" })).toBe("unavailable");
    // Unknown history is never usable, whatever the chain says.
    expect(qsbVaultDisplay({ ...depositedVault(0, "confirmed"), state: "unknown" })).toBe(
      "unavailable",
    );
  });

  test("vaults count from 1", () => {
    expect(qsbVaultLabel(0)).toBe("Vault 1");
    expect(qsbVaultLabel(41)).toBe("Vault 42");
  });

  test("polling continues only while a deposit is waiting or sent", () => {
    expect(qsbDepositInFlight([unfundedVault(0), depositedVault(1, "confirmed")])).toBe(false);
    expect(qsbDepositInFlight([depositedVault(1, "pending")])).toBe(true);
    expect(qsbDepositInFlight([depositedVault(1, "submitted")])).toBe(true);
    expect(qsbDepositInFlight([{ ...depositedVault(1, "pending"), state: "unknown" }])).toBe(false);
  });

  test("the explorer link is built only for a deposit on the network", () => {
    expect(qsbDepositLink(depositedVault(0, "submitted"))).toBe(
      `https://mempool.space/tx/${QSB_TXID}`,
    );
    expect(qsbDepositLink(depositedVault(0, "confirmed"))).toBe(
      `https://mempool.space/tx/${QSB_TXID}`,
    );
    expect(qsbDepositLink(depositedVault(0, "pending"))).toBe(null);
    expect(qsbDepositLink(unfundedVault(0))).toBe(null);
    const forged = depositedVault(0, "submitted");
    expect(qsbDepositLink({ ...forged, deposit: { ...forged.deposit, txid: "../../evil" } })).toBe(
      null,
    );
  });

  test("an account that cannot make vaults says why", () => {
    expect(qsbNoVaultLine(QSB_VIEWS.ready)).toBe(null);
    expect(qsbNoVaultLine(QSB_VIEWS.backupNeeded)).toBe(
      "Back up this account's phrase to make vaults.",
    );
    expect(qsbNoVaultLine(QSB_VIEWS.readOnly)).toBe(
      "An imported phrase can't create new vaults here.",
    );
    expect(qsbNoVaultLine(QSB_VIEWS.historyUnavailable)).toBe(
      "Bramble won't release any of its keys.",
    );
  });
});

describe("write failures", () => {
  test("a lost reply is never a failure; a refusal keeps its reviewed copy", () => {
    expect(
      qsbVaultWriteFailure(new SubmissionUnknownError("x", null), "wallet request failed"),
    ).toBe("Bramble couldn't confirm this finished. Refresh the account before trying again.");
    expect(qsbVaultWriteFailure(new Error("wallet request failed"), "wallet request failed")).toBe(
      "Bramble couldn't confirm this finished. Refresh the account before trying again.",
    );
    expect(qsbVaultWriteFailure(new Error(QSB_VAULT_REFUSALS.vaultLimit), "x")).toBe(
      "This account already holds as many vaults as it can.",
    );
    expect(isQsbQuoteChanged(new Error(QSB_VAULT_REFUSALS.quoteChanged))).toBe(true);
    expect(isQsbQuoteChanged(new Error(QSB_VAULT_REFUSALS.insufficientFunds))).toBe(false);
    expect(isQsbQuoteChanged(QSB_VAULT_REFUSALS.quoteChanged)).toBe(false);
  });
});
