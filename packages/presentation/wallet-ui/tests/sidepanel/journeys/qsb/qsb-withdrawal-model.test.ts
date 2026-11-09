/**
 * The pure QSB withdrawal model: which state a deposit's withdrawal shows
 * (never one for a deposit whose history is not trusted), when the QSB vault
 * screen keeps polling, which deposits may start one, the explorer link built
 * only for a withdrawal on the network, the typed-address normalisation, and
 * the BIP's unverified-binding statement naming the contract's secret count.
 */
import { describe, expect, test } from "bun:test";
import { QSB_DISCLOSED_SECRETS } from "@bramble/wallet-model/qsb-withdrawals";
import {
  QSB_UNVERIFIED_BODY,
  qsbTypedDestination,
  qsbWithdrawable,
  qsbWithdrawalDisplay,
  qsbWithdrawalInFlight,
  qsbWithdrawalLink,
} from "../../../../src/sidepanel/journeys/qsb/qsb-withdrawal-model";
import {
  DESTINATION,
  depositedVault,
  unfundedVault,
  WITHDRAWAL_TXID,
  withdrawingVault,
} from "../../../support/qsb-vault-fixtures";

describe("withdrawal rows", () => {
  test("each status has one display; untrusted history shows only a recovered withdrawal", () => {
    expect(
      (
        [
          "none",
          "searching",
          "paused",
          "failed",
          "ready",
          "pending",
          "submitted",
          "uncertain",
          "confirmed",
          "conflict",
        ] as const
      ).map((status) => qsbWithdrawalDisplay(withdrawingVault(0, status))),
    ).toEqual([
      null,
      "searching",
      "paused",
      "failed",
      "ready",
      "sending",
      "sent",
      "uncertain",
      "withdrawn",
      "conflict",
    ]);
    // A recovered withdrawal shows on its `unknown` deposit; nothing else does.
    expect(qsbWithdrawalDisplay({ ...withdrawingVault(0, "ready"), state: "unknown" })).toBe(
      "ready",
    );
    expect(qsbWithdrawalDisplay({ ...depositedVault(0, "confirmed"), state: "unknown" })).toBe(
      null,
    );
  });

  test("only a funded deposit with nothing started may be withdrawn", () => {
    expect(qsbWithdrawable(depositedVault(0, "confirmed"))).toBe(true);
    expect(qsbWithdrawable(depositedVault(0, "submitted"))).toBe(false);
    expect(qsbWithdrawable(unfundedVault(0))).toBe(false);
    expect(qsbWithdrawable(withdrawingVault(0, "failed"))).toBe(false);
    expect(qsbWithdrawable({ ...depositedVault(0, "confirmed"), state: "unknown" })).toBe(false);
  });

  test("the poll runs while a withdrawal moves on its own", () => {
    for (const status of ["searching", "pending", "uncertain", "submitted"] as const) {
      expect(qsbWithdrawalInFlight([withdrawingVault(0, status)])).toBe(true);
    }
    for (const status of ["none", "paused", "failed", "ready", "confirmed", "conflict"] as const) {
      expect(qsbWithdrawalInFlight([withdrawingVault(0, status)])).toBe(false);
    }
  });

  test("the explorer link is built only once MARA has the withdrawal", () => {
    expect(qsbWithdrawalLink(withdrawingVault(0, "submitted"))).toBe(
      `https://mempool.space/tx/${WITHDRAWAL_TXID}`,
    );
    expect(qsbWithdrawalLink(withdrawingVault(0, "confirmed"))).toBe(
      `https://mempool.space/tx/${WITHDRAWAL_TXID}`,
    );
    expect(qsbWithdrawalLink(withdrawingVault(0, "pending"))).toBe(null);
    expect(qsbWithdrawalLink(withdrawingVault(0, "uncertain"))).toBe(null);
  });
});

describe("copy", () => {
  test("a typed address is trimmed, and only an all-uppercase bech32 one is lowercased", () => {
    expect(qsbTypedDestination(`  ${DESTINATION}\n`)).toBe(DESTINATION);
    expect(qsbTypedDestination(DESTINATION.toUpperCase())).toBe(DESTINATION);
    expect(qsbTypedDestination("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2")).toBe(
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
    );
  });

  test("the unverified-binding statement names the contract's count and no contraction", () => {
    expect(QSB_UNVERIFIED_BODY).toContain(`these ${QSB_DISCLOSED_SECRETS} keys`);
    expect(QSB_UNVERIFIED_BODY).not.toMatch(/n't/);
  });
});
