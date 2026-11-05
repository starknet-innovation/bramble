/**
 * The QSB withdrawal journey through the real background router, vault
 * service and Krusty, against the stand-in coordinator and runtime: quote,
 * start, search, review, release, submit, confirm and resend, and the order
 * of every durable write against every request — the intent kept before the
 * job is created, the exposure recorded before `finish` sees a preimage, the
 * signed bytes kept before they are submitted.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import { Transaction } from "@scure/btc-signer";
import {
  DESTINATION,
  HELPER_SAT,
  qsbWithdrawalHarness,
  WITHDRAWN_DEPOSIT_SAT,
} from "../../support/qsb-withdrawal-harness";

const JOURNAL_KEY = /^write bramble:qsb-journal:/;
const WITHDRAWAL_KEY = /^write bramble:qsb-withdrawal:/;

const indexOf = (events: readonly string[], match: RegExp | string): number =>
  events.findIndex((event) => (typeof match === "string" ? event === match : match.test(event)));

const listed = async (harness: Awaited<ReturnType<typeof qsbWithdrawalHarness>>) =>
  (
    (await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" })) as {
      readonly vaults: readonly QsbVaultView[];
    }
  ).vaults[0]?.withdrawal;

describe("the QSB withdrawal journey", () => {
  test("quotes, starts, reviews, releases, submits and confirms a withdrawal", async () => {
    const harness = await qsbWithdrawalHarness();
    const finishing = harness.runtime.finish;
    harness.runtime.finish = async (prepared, preimages) => {
      harness.events.push("finish");
      return finishing(prepared, preimages);
    };

    // Floor 2 sat/vB, so 4 sat/vB on the 1,338 vB bound of a P2WPKH payout.
    const quote = await harness.quote();
    expect(quote).toEqual({
      destination: DESTINATION,
      feeRate: "4",
      feeSat: 5_352,
      fundingSat: WITHDRAWN_DEPOSIT_SAT,
      helperSat: HELPER_SAT,
      outputSat: WITHDRAWN_DEPOSIT_SAT + HELPER_SAT - 5_352,
      vsize: 1_338,
    });

    const started = await harness.start(quote.feeSat);
    expect((started["vault"] as QsbVaultView).withdrawal).toEqual({
      confirmations: null,
      destination: DESTINATION,
      feeSat: 5_352,
      outputSat: quote.outputSat,
      status: "searching",
      txid: null,
    });
    // The intent is durable before the job is created.
    expect(indexOf(harness.events, WITHDRAWAL_KEY)).toBeLessThan(
      indexOf(harness.events, "call POST /v1/jobs"),
    );
    const job = harness.state.jobs.get(harness.jobId());
    expect(job?.manifestHash).toBe(
      createHash("sha256").update(JSON.stringify(job?.manifest)).digest("hex"),
    );
    expect(await listed(harness)).toMatchObject({ status: "searching", txid: null });

    harness.solve();
    expect(await listed(harness)).toMatchObject({ status: "ready", txid: null });
    const review = await harness.review();
    expect(review).toMatchObject({
      binding: "unverified",
      destination: DESTINATION,
      feeSat: 5_352,
      fundingSat: WITHDRAWN_DEPOSIT_SAT,
      helperSat: HELPER_SAT,
      network: "bitcoin-mainnet",
      outputSat: quote.outputSat,
      secrets: 15,
      v: 0,
      vsize: 1_338,
    });
    expect(review.digest).toMatch(/^[0-9a-f]{64}$/);

    harness.events.length = 0;
    const released = await harness.release(review.digest);
    expect(released).toMatchObject({ ok: true, submission: "submitted" });
    const withdrawal = (released["vault"] as QsbVaultView).withdrawal;
    expect(withdrawal).toMatchObject({ destination: DESTINATION, status: "submitted" });
    expect(harness.runtime.finished).toHaveLength(15);
    // Exposure, then finish, then the signed bytes, then the submission.
    const exposed = indexOf(harness.events, JOURNAL_KEY);
    const finished = indexOf(harness.events, "finish");
    const kept = indexOf(harness.events, WITHDRAWAL_KEY);
    const submitted = indexOf(harness.events, `call POST /v1/jobs/${harness.jobId()}/submit`);
    expect([exposed < finished, finished < kept, kept < submitted]).toEqual([true, true, true]);
    expect((released["vault"] as QsbVaultView).state).toBe("exposed");

    // What reached the coordinator is a finalized, two-input withdrawal.
    const [sent] = [...harness.state.transactions.values()];
    const tx = Transaction.fromRaw(Buffer.from(sent?.raw ?? "", "hex"), {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
      disableScriptCheck: true,
    });
    expect([tx.inputsLength, tx.outputsLength, tx.id]).toEqual([2, 1, String(withdrawal.txid)]);
    expect(tx.getOutput(0).amount).toBe(BigInt(quote.outputSat));

    expect(await listed(harness)).toMatchObject({ status: "submitted", txid: withdrawal.txid });
    harness.state.confirmed.add(withdrawal.txid ?? "");
    expect(await listed(harness)).toEqual({
      confirmations: 1,
      destination: DESTINATION,
      feeSat: 5_352,
      outputSat: quote.outputSat,
      status: "confirmed",
      txid: withdrawal.txid,
    });

    // A resend sends the same bytes; the coordinator answers from its record.
    const resent = await harness.send({
      accountId: "qsb-1",
      type: "wallet.resendQsbWithdrawal",
      v: 0,
    });
    expect(resent).toMatchObject({ ok: true, submission: "confirmed" });
    expect(harness.state.transactions.size).toBe(1);
  }, 120_000);

  test("a quote of an intent already kept answers with its own terms", async () => {
    const harness = await qsbWithdrawalHarness();
    const quote = await harness.quote();
    harness.state.refusals.set("POST /jobs", { code: "chain_unavailable", status: 503 });
    expect(await harness.start(quote.feeSat)).toEqual({ error: "qsb coordinator unavailable" });
    // The floor moved, but the kept intent's terms stand.
    harness.state.rates = { market_rate: 1, submit_fee_rate: 3 };
    expect(await harness.quote()).toMatchObject({ feeSat: 5_352, outputSat: quote.outputSat });
    harness.state.refusals.clear();
    expect(await harness.start(quote.feeSat)).toMatchObject({ ok: true });
    expect(harness.state.jobs.size).toBe(1);
  }, 120_000);
});
