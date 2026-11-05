/**
 * Every refusal of the QSB withdrawal flows, each before anything is
 * disclosed, and the retry rules after a disclosure: a release that cannot
 * finish answers an unknown outcome, never a refusal, leaves the deposit
 * ready, and a fresh release re-releases exactly the same 15 preimages; a
 * different `T` or index order after the disclosure releases nothing new.
 * A helper is frozen from the intent on: a deposit never spends it.
 */
import { describe, expect, test } from "bun:test";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_WITHDRAWAL_REFUSALS } from "@bramble/wallet-model/qsb-withdrawals";
import { QSB_WITHDRAWAL_OUTCOME_UNKNOWN } from "../../../apps/extension/src/background/qsb/qsb-withdrawal-release";
import { paymentToAddress } from "../../support/qsb-coordinator-fake";
import { FAKE_SOLUTION } from "../../support/qsb-withdrawal-fake";
import { qsbWithdrawalHarness } from "../../support/qsb-withdrawal-harness";

const refused = (message: string) => ({ error: message });
const W = QSB_WITHDRAWAL_REFUSALS;

const journalState = async (harness: Awaited<ReturnType<typeof qsbWithdrawalHarness>>) =>
  (
    (await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" })) as {
      readonly vaults: readonly QsbVaultView[];
    }
  ).vaults[0];

// A withdrawal started and solved, its review in hand.
const reviewed = async () => {
  const harness = await qsbWithdrawalHarness();
  const quote = await harness.quote();
  await harness.start(quote.feeSat);
  harness.solve();
  return { harness, quote, review: await harness.review() };
};

describe("before a withdrawal starts", () => {
  test("refuses a destination it may not pay, and dust", async () => {
    const harness = await qsbWithdrawalHarness();
    for (const destination of ["bc1pfeessrawgf", "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"]) {
      expect(
        await harness.send({
          accountId: "qsb-1",
          destination,
          type: "wallet.quoteQsbWithdrawal",
          v: 0,
        }),
      ).toEqual(refused(W.destinationInvalid));
    }
    harness.state.rates = { market_rate: 39, submit_fee_rate: 2 };
    expect(
      await harness.send({
        accountId: "qsb-1",
        destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        type: "wallet.quoteQsbWithdrawal",
        v: 0,
      }),
    ).toEqual(refused(W.dustOutput));
  }, 120_000);

  test("refuses without a helper, for an unfunded deposit, and for an unknown one", async () => {
    const harness = await qsbWithdrawalHarness();
    harness.state.utxos = [];
    expect(
      await harness.send({
        accountId: "qsb-1",
        destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        type: "wallet.quoteQsbWithdrawal",
        v: 0,
      }),
    ).toEqual(refused(W.helperNeeded));
    await harness.send({ accountId: "qsb-1", type: "wallet.createQsbVault" });
    for (const [v, message] of [
      [1, W.notWithdrawable],
      [9, QSB_VAULT_REFUSALS.unknownVault],
    ] as const) {
      expect(
        await harness.send({
          accountId: "qsb-1",
          destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
          type: "wallet.quoteQsbWithdrawal",
          v,
        }),
      ).toEqual(refused(message));
    }
  }, 120_000);

  test("refuses a start at any fee but the quoted one, writing nothing", async () => {
    const harness = await qsbWithdrawalHarness();
    const quote = await harness.quote();
    expect(await harness.start(quote.feeSat + 1)).toEqual(refused(W.quoteChanged));
    expect(harness.events.filter((event) => event.startsWith("write"))).toEqual([]);
    expect(harness.state.jobs.size).toBe(0);
  }, 120_000);

  test("a final job refusal is kept: the deposit shows failed and never starts again", async () => {
    const harness = await qsbWithdrawalHarness();
    const quote = await harness.quote();
    harness.state.refusals.set("POST /jobs", { code: "withdrawal_invalid", status: 400 });
    expect(await harness.start(quote.feeSat)).toEqual(refused(W.jobRefused));
    harness.state.refusals.clear();
    expect((await journalState(harness))?.withdrawal).toMatchObject({
      status: "failed",
      txid: null,
    });
    expect(await harness.start(quote.feeSat)).toEqual(refused(W.notWithdrawable));
  }, 120_000);

  test("without the grant, every withdrawal message refuses and nothing is sent", async () => {
    const harness = await qsbWithdrawalHarness();
    harness.grant(false);
    harness.state.calls.length = 0;
    for (const message of [
      {
        destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        type: "wallet.quoteQsbWithdrawal",
      },
      {
        destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        feeSat: 1,
        type: "wallet.startQsbWithdrawal",
      },
      { type: "wallet.reviewQsbWithdrawal" },
      {
        digest: "00".repeat(32),
        passphrase: "correct horse battery staple",
        type: "wallet.releaseQsbWithdrawal",
      },
      { type: "wallet.resendQsbWithdrawal" },
    ]) {
      expect(await harness.send({ accountId: "qsb-1", v: 0, ...message })).toEqual(
        refused(QSB_VAULT_REFUSALS.accessNeeded),
      );
    }
    expect(harness.state.calls).toEqual([]);
  }, 120_000);
});

describe("before anything is disclosed", () => {
  test("a review before the search is done is not ready", async () => {
    const harness = await qsbWithdrawalHarness();
    await harness.start((await harness.quote()).feeSat);
    expect(
      await harness.send({ accountId: "qsb-1", type: "wallet.reviewQsbWithdrawal", v: 0 }),
    ).toEqual(refused(W.notReady));
  }, 120_000);

  test("a solution the pipeline cannot assemble is refused and discloses nothing", async () => {
    const harness = await qsbWithdrawalHarness();
    await harness.start((await harness.quote()).feeSat);
    harness.solve();
    harness.runtime.prepareRefuses = true;
    expect(
      await harness.send({ accountId: "qsb-1", type: "wallet.reviewQsbWithdrawal", v: 0 }),
    ).toEqual(refused(W.bindingRefused));
    expect(await harness.release("00".repeat(32))).toEqual(refused(W.bindingRefused));
    expect(harness.runtime.finished).toEqual([]);
    expect((await journalState(harness))?.state).toBe("allocated");
  }, 120_000);

  test("a solution out of the submittable range is refused", async () => {
    const harness = await qsbWithdrawalHarness();
    await harness.start((await harness.quote()).feeSat);
    harness.solve({ ...FAKE_SOLUTION, locktime: 499_999_999 });
    expect(
      await harness.send({ accountId: "qsb-1", type: "wallet.reviewQsbWithdrawal", v: 0 }),
    ).toEqual(refused(W.bindingRefused));
  }, 120_000);

  test("a wrong password, another digest or a risen floor releases nothing", async () => {
    const { harness, review } = await reviewed();
    expect(await harness.release(review.digest, "not the wallet password")).toEqual(
      refused("Incorrect passphrase"),
    );
    expect(await harness.release("00".repeat(32))).toEqual(refused(W.reviewChanged));
    harness.state.rates = { market_rate: 5, submit_fee_rate: 2 };
    expect(await harness.release(review.digest)).toEqual(refused(W.floorRisen));
    expect(harness.runtime.finished).toEqual([]);
    expect((await journalState(harness))?.state).toBe("allocated");
  }, 120_000);
});

describe("after a disclosure", () => {
  test("a release that cannot finish is an unknown outcome, and a fresh one re-releases the same 15", async () => {
    const { harness, review } = await reviewed();
    harness.runtime.finishFails = true;
    expect(await harness.release(review.digest)).toEqual(refused(QSB_WITHDRAWAL_OUTCOME_UNKNOWN));
    const first = [...harness.runtime.finished];
    expect(first).toHaveLength(15);
    expect(await journalState(harness)).toMatchObject({
      state: "exposed",
      withdrawal: { status: "ready" },
    });
    harness.runtime.finishFails = false;
    const again = await harness.release((await harness.review()).digest);
    expect(again).toMatchObject({ ok: true, submission: "submitted" });
    expect(harness.runtime.finished.slice(15)).toEqual(first);
  }, 120_000);

  test("a signing failure is an unknown outcome, keeps nothing, and the retry is exact", async () => {
    // Off while the deposit is signed, on for the withdrawal's helper.
    let failSigning = false;
    const harness = await qsbWithdrawalHarness({
      kms: (kms) => ({
        ...kms,
        signBitcoinPsbtInputs: async (key, psbt, indices) => {
          if (failSigning) throw new Error("signer crashed");
          return kms.signBitcoinPsbtInputs(key, psbt, indices);
        },
      }),
    });
    await harness.start((await harness.quote()).feeSat);
    harness.solve();
    const review = await harness.review();
    failSigning = true;
    expect(await harness.release(review.digest)).toEqual(refused(QSB_WITHDRAWAL_OUTCOME_UNKNOWN));
    expect(harness.state.transactions.size).toBe(0);
    expect(await journalState(harness)).toMatchObject({
      state: "exposed",
      withdrawal: { status: "ready" },
    });
    failSigning = false;
    expect(await harness.release((await harness.review()).digest)).toMatchObject({
      submission: "submitted",
    });
    expect(harness.runtime.finished.slice(15)).toEqual(harness.runtime.finished.slice(0, 15));
  }, 120_000);

  test("another solution after the disclosure releases nothing new", async () => {
    const { harness, review } = await reviewed();
    harness.runtime.finishFails = true;
    await harness.release(review.digest);
    harness.runtime.finishFails = false;
    harness.solve({ ...FAKE_SOLUTION, locktime: FAKE_SOLUTION.locktime + 1 });
    const changed = await harness.review();
    expect(changed.digest).not.toBe(review.digest);
    expect(await harness.release(changed.digest)).toEqual(refused(W.bindingRefused));
    expect(harness.runtime.finished).toHaveLength(15);
  }, 120_000);

  test("signed bytes under the floor are kept, not sent, and resent only once it clears", async () => {
    const { harness, review } = await reviewed();
    const finishing = harness.runtime.finish;
    harness.runtime.finish = async (prepared, preimages) => {
      // The floor rises between the disclosure and the submission.
      harness.state.rates = { market_rate: 20, submit_fee_rate: 2 };
      return finishing(prepared, preimages);
    };
    const released = await harness.release(review.digest);
    expect(released).toMatchObject({
      submission: "uncertain",
      vault: { withdrawal: { status: "pending" } },
    });
    expect(harness.state.transactions.size).toBe(0);
    const resend = { accountId: "qsb-1", type: "wallet.resendQsbWithdrawal", v: 0 };
    expect(await harness.send(resend)).toEqual(refused(W.floorRisen));
    harness.state.rates = { market_rate: 1, submit_fee_rate: 2 };
    expect(await harness.send(resend)).toMatchObject({ submission: "submitted" });
  }, 120_000);
});

describe("the frozen helper", () => {
  test("a deposit never spends a withdrawal's helper output", async () => {
    const harness = await qsbWithdrawalHarness();
    harness.state.utxos = paymentToAddress(harness.owner, [60_000], "the only owner output");
    await harness.start((await harness.quote()).feeSat);
    await harness.send({ accountId: "qsb-1", type: "wallet.createQsbVault" });
    expect(
      await harness.send({
        accountId: "qsb-1",
        amountSat: 20_000,
        type: "wallet.quoteQsbDeposit",
        v: 1,
      }),
    ).toEqual(refused(QSB_VAULT_REFUSALS.insufficientFunds));
  }, 120_000);
});
