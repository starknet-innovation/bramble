/**
 * The QSB withdrawal client against stubbed background replies: each of the
 * five messages is sent with exactly the contract's fields, every reply is
 * validated strictly (keys, the destination grammar, satoshi ranges, the sum
 * the destination receives, the unverified binding, the 15 secrets, the
 * digest, and each write's own rule), a deposit's withdrawal view follows the
 * contract's rules, and a refusal or a lost reply rejects the way the panel
 * can tell apart.
 */
import { describe, expect, test } from "bun:test";
import { QSB_MAX_SAT, QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import {
  isQsbDestination,
  isQsbWithdrawalView,
} from "../../../../src/sidepanel/journeys/qsb/qsb-vault-runtime";
import {
  createQsbWithdrawalClient,
  isQsbWithdrawalQuote,
  isQsbWithdrawalReview,
} from "../../../../src/sidepanel/journeys/qsb/qsb-withdrawal-runtime";
import { createSidepanelRuntime } from "../../../../src/sidepanel/runtime/runtime";
import { READ_ONLY_MESSAGES } from "../../../../src/sidepanel/runtime/runtime-errors";
import {
  DESTINATION,
  DIGEST,
  QSB_ADDRESS,
  WITHDRAWAL_QUOTE,
  WITHDRAWAL_TXID,
  withdrawalResult,
  withdrawalReview,
  withdrawingVault,
} from "../../../support/qsb-vault-fixtures";

const answering = (reply: unknown) => {
  const sent: unknown[] = [];
  const client = createQsbWithdrawalClient(async (message) => {
    sent.push(message);
    return reply;
  });
  return { client, sent };
};

const rejection = async (run: () => Promise<unknown>): Promise<Error> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected a rejection");
};

describe("destinations", () => {
  test("read as mainnet bech32 or base58 addresses, nothing else", () => {
    for (const address of [
      DESTINATION,
      QSB_ADDRESS,
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      "bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297",
    ]) {
      expect(isQsbDestination(address)).toBe(true);
    }
    for (const address of [
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      DESTINATION.toUpperCase(),
      `${DESTINATION} `,
      "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN0",
      "",
      42,
    ]) {
      expect(isQsbDestination(address)).toBe(false);
    }
  });
});

describe("a deposit's withdrawal", () => {
  test("follows the contract: nothing before a start, a txid only from release on", () => {
    for (const status of [
      "none",
      "searching",
      "paused",
      "failed",
      "ready",
      "pending",
      "uncertain",
      "submitted",
      "confirmed",
      "conflict",
    ] as const) {
      expect(isQsbWithdrawalView(withdrawingVault(0, status).withdrawal)).toBe(true);
    }
    const searching = withdrawingVault(0, "searching").withdrawal;
    const sent = withdrawingVault(0, "submitted").withdrawal;
    const none = withdrawingVault(0, "none").withdrawal;
    expect(isQsbWithdrawalView({ ...sent, status: "conflict", txid: null })).toBe(true);
    for (const bad of [
      { ...none, destination: DESTINATION },
      { ...none, feeSat: 0 },
      { ...searching, destination: null },
      { ...searching, feeSat: null },
      { ...searching, outputSat: null },
      { ...searching, txid: WITHDRAWAL_TXID },
      { ...searching, confirmations: 0 },
      { ...sent, txid: null },
      { ...sent, txid: null, confirmations: 1, status: "conflict" },
      { ...sent, feeSat: QSB_MAX_SAT, outputSat: 1 },
      { ...sent, destination: "bc1qshort" },
      { ...sent, status: "released" },
      { ...sent, digest: DIGEST },
      { ...sent, txid: WITHDRAWAL_TXID.toUpperCase() },
    ]) {
      expect(isQsbWithdrawalView(bad)).toBe(false);
    }
  });
});

describe("quotes and reviews", () => {
  test("a quote must add up: the deposit plus the helper, less the fee", () => {
    expect(isQsbWithdrawalQuote(WITHDRAWAL_QUOTE)).toBe(true);
    for (const bad of [
      { ...WITHDRAWAL_QUOTE, outputSat: 109_101 },
      { ...WITHDRAWAL_QUOTE, feeSat: 110_000, outputSat: 0 },
      { ...WITHDRAWAL_QUOTE, helperSat: 0, outputSat: 99_100 },
      { ...WITHDRAWAL_QUOTE, vsize: 0 },
      { ...WITHDRAWAL_QUOTE, feeRate: 4 },
      { ...WITHDRAWAL_QUOTE, feeRate: "4e0" },
      { ...WITHDRAWAL_QUOTE, destination: "not an address" },
      { ...WITHDRAWAL_QUOTE, withdrawalFeeSat: 1 },
      { ...WITHDRAWAL_QUOTE, feeSat: -1 },
    ]) {
      expect(isQsbWithdrawalQuote(bad)).toBe(false);
    }
  });

  test("a review is unverified, on mainnet, names 15 secrets and a 64-hex digest, and adds up", () => {
    expect(isQsbWithdrawalReview(withdrawalReview(2))).toBe(true);
    const review = withdrawalReview(2);
    for (const bad of [
      { ...review, binding: "verified" },
      { ...review, network: "bitcoin-testnet" },
      { ...review, secrets: 16 },
      { ...review, digest: DIGEST.toUpperCase() },
      { ...review, digest: DIGEST.slice(2) },
      { ...review, outputSat: review.outputSat + 1 },
      { ...review, v: -1 },
      { ...review, vsize: 0 },
      { ...review, signature: "00" },
      { ...review, destination: "bc1q" },
    ]) {
      expect(isQsbWithdrawalReview(bad)).toBe(false);
    }
  });
});

describe("createQsbWithdrawalClient", () => {
  test("sends each message with exactly its contract fields", async () => {
    const quoted = answering({ ok: true, quote: WITHDRAWAL_QUOTE });
    expect(await quoted.client.quoteQsbWithdrawal("qsb-2", 3, DESTINATION)).toEqual(
      WITHDRAWAL_QUOTE,
    );
    expect(quoted.sent).toEqual([
      { accountId: "qsb-2", destination: DESTINATION, type: "wallet.quoteQsbWithdrawal", v: 3 },
    ]);

    const started = answering({ ok: true, vault: withdrawingVault(3, "searching") });
    expect((await started.client.startQsbWithdrawal("qsb-2", 3, DESTINATION, 900)).v).toBe(3);
    expect(started.sent).toEqual([
      {
        accountId: "qsb-2",
        destination: DESTINATION,
        feeSat: 900,
        type: "wallet.startQsbWithdrawal",
        v: 3,
      },
    ]);

    const reviewed = answering({ ok: true, review: withdrawalReview(3) });
    expect(await reviewed.client.reviewQsbWithdrawal("qsb-2", 3)).toEqual(withdrawalReview(3));
    expect(reviewed.sent).toEqual([
      { accountId: "qsb-2", type: "wallet.reviewQsbWithdrawal", v: 3 },
    ]);

    const released = answering({ ok: true, ...withdrawalResult(3, "submitted") });
    expect(
      (await released.client.releaseQsbWithdrawal("qsb-2", 3, DIGEST, "correct horse")).submission,
    ).toBe("submitted");
    expect(released.sent).toEqual([
      {
        accountId: "qsb-2",
        digest: DIGEST,
        passphrase: "correct horse",
        type: "wallet.releaseQsbWithdrawal",
        v: 3,
      },
    ]);

    const resent = answering({ ok: true, ...withdrawalResult(3, "uncertain") });
    expect((await resent.client.resendQsbWithdrawal("qsb-2", 3)).submission).toBe("uncertain");
    expect(resent.sent).toEqual([{ accountId: "qsb-2", type: "wallet.resendQsbWithdrawal", v: 3 }]);
  });

  test("each reply must be what was asked", async () => {
    const otherDestination = answering({
      ok: true,
      quote: { ...WITHDRAWAL_QUOTE, destination: QSB_ADDRESS },
    });
    expect(
      (await rejection(() => otherDestination.client.quoteQsbWithdrawal("qsb-2", 3, DESTINATION)))
        .message,
    ).toBe("wallet unavailable");
    const otherReview = answering({ ok: true, review: withdrawalReview(4) });
    expect(
      (await rejection(() => otherReview.client.reviewQsbWithdrawal("qsb-2", 3))).message,
    ).toBe("wallet unavailable");
    // A start answers that deposit, searching, at that destination and fee.
    for (const vault of [
      withdrawingVault(4, "searching"),
      withdrawingVault(3, "ready"),
      {
        ...withdrawingVault(3, "searching"),
        withdrawal: {
          ...withdrawingVault(3, "searching").withdrawal,
          feeSat: 901,
          outputSat: 109_099,
        },
      },
    ]) {
      const { client } = answering({ ok: true, vault });
      expect(
        (await rejection(() => client.startQsbWithdrawal("qsb-2", 3, DESTINATION, 900))).message,
      ).toBe("wallet request failed");
    }
  });

  test("a release or resend reply is that deposit, in the status its outcome implies", async () => {
    for (const submission of ["conflict", "confirmed", "submitted", "uncertain"] as const) {
      const { client } = answering({ ok: true, ...withdrawalResult(1, submission) });
      expect((await client.releaseQsbWithdrawal("qsb-2", 1, DIGEST, "pw")).submission).toBe(
        submission,
      );
    }
    // MARA may have mined a submitted one; an uncertain one may still be pending here.
    const mined = answering({
      ok: true,
      submission: "submitted",
      vault: withdrawingVault(1, "confirmed"),
    });
    expect((await mined.client.resendQsbWithdrawal("qsb-2", 1)).vault.withdrawal.status).toBe(
      "confirmed",
    );
    const pending = answering({
      ok: true,
      submission: "uncertain",
      vault: withdrawingVault(1, "pending"),
    });
    expect((await pending.client.resendQsbWithdrawal("qsb-2", 1)).submission).toBe("uncertain");
    for (const reply of [
      { ok: true, ...withdrawalResult(2, "submitted") },
      { ok: true, submission: "submitted", vault: withdrawingVault(1, "pending") },
      { ok: true, submission: "confirmed", vault: withdrawingVault(1, "submitted") },
      { ok: true, submission: "conflict", vault: withdrawingVault(1, "uncertain") },
      { ok: true, submission: "uncertain", vault: withdrawingVault(1, "ready") },
      { ok: true, submission: "sent", vault: withdrawingVault(1, "submitted") },
      { ...withdrawalResult(1, "submitted") },
    ]) {
      const { client } = answering(reply);
      expect(
        (await rejection(() => client.releaseQsbWithdrawal("qsb-2", 1, DIGEST, "pw"))).message,
      ).toBe("wallet request failed");
      expect((await rejection(() => client.resendQsbWithdrawal("qsb-2", 1))).message).toBe(
        "wallet request failed",
      );
    }
  });

  test("a refusal rejects with the background's diagnostic", async () => {
    type Client = ReturnType<typeof createQsbWithdrawalClient>;
    for (const [run, diagnostic] of [
      [
        (c: Client) => c.quoteQsbWithdrawal("qsb-2", 0, DESTINATION),
        QSB_WITHDRAWAL_REFUSALS.helperNeeded,
      ],
      [
        (c: Client) => c.startQsbWithdrawal("qsb-2", 0, DESTINATION, 1),
        QSB_WITHDRAWAL_REFUSALS.quoteChanged,
      ],
      [(c: Client) => c.reviewQsbWithdrawal("qsb-2", 0), QSB_WITHDRAWAL_REFUSALS.notReady],
      [
        (c: Client) => c.releaseQsbWithdrawal("qsb-2", 0, DIGEST, "pw"),
        QSB_WITHDRAWAL_REFUSALS.reviewChanged,
      ],
      [(c: Client) => c.resendQsbWithdrawal("qsb-2", 0), QSB_VAULT_REFUSALS.accessNeeded],
    ] as const) {
      const { client } = answering({ error: diagnostic });
      expect((await rejection(() => run(client))).message).toBe(diagnostic);
    }
  });
});

describe("lost replies", () => {
  const lost = {
    sendMessage: () => Promise.reject(new Error("The message port closed before a response.")),
  };

  test("the quote and the review are reads; start, release and resend are writes", async () => {
    expect(READ_ONLY_MESSAGES.has("wallet.quoteQsbWithdrawal")).toBe(true);
    expect(READ_ONLY_MESSAGES.has("wallet.reviewQsbWithdrawal")).toBe(true);
    for (const type of [
      "wallet.startQsbWithdrawal",
      "wallet.releaseQsbWithdrawal",
      "wallet.resendQsbWithdrawal",
    ]) {
      expect(READ_ONLY_MESSAGES.has(type)).toBe(false);
    }
    const wallet = createSidepanelRuntime(lost);
    expect(
      await rejection(() => wallet.quoteQsbWithdrawal("qsb-2", 0, DESTINATION)),
    ).not.toBeInstanceOf(SubmissionUnknownError);
    expect(await rejection(() => wallet.reviewQsbWithdrawal("qsb-2", 0))).not.toBeInstanceOf(
      SubmissionUnknownError,
    );
    for (const write of [
      () => wallet.startQsbWithdrawal("qsb-2", 0, DESTINATION, 900),
      () => wallet.releaseQsbWithdrawal("qsb-2", 0, DIGEST, "pw"),
      () => wallet.resendQsbWithdrawal("qsb-2", 0),
    ]) {
      expect(await rejection(write)).toBeInstanceOf(SubmissionUnknownError);
    }
  });
});
