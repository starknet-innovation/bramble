/**
 * `wallet.recoverQsbVaults` through the real background router, vault
 * services and Krusty, against the stand-in coordinator: the install that
 * created a QSB vault started a withdrawal and was lost; a fresh install
 * imported the phrase. Recovery finds the vault by its script, records it
 * `unknown` (never `allocated`) with its funding only once `/funding` proves
 * it, durably before it adopts the withdrawal, and adopts the job only when
 * every term of its manifest checks out. Running it again writes nothing.
 * The emergency release then works from that `unknown` record and leaves it
 * `unknown`; the writer is refused recovery, and so is a request without the
 * coordinator grant.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import {
  QSB_WITHDRAWAL_REFUSALS,
  type QsbWithdrawalReview,
} from "@bramble/wallet-model/qsb-withdrawals";
import { qsbRecoveryHarness } from "../../support/qsb-recovery-harness";
import { DESTINATION, WITHDRAWN_DEPOSIT_SAT } from "../../support/qsb-withdrawal-harness";

const JOURNAL_KEY = /^write bramble:qsb-journal:/;
const WITHDRAWAL_KEY = /^write bramble:qsb-withdrawal:/;
// Another payable mainnet address (BIP-173's P2WPKH vector).
const OTHER_DESTINATION = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

const indexOf = (events: readonly string[], match: RegExp): number =>
  events.findIndex((event) => match.test(event));

const vaultsOf = (reply: Record<string, unknown>): readonly QsbVaultView[] =>
  (reply as { readonly vaults: readonly QsbVaultView[] }).vaults;

describe("recovering a lost writer's deposits", () => {
  test("records the deposit unknown with its verified funding, then adopts its withdrawal", async () => {
    const recovery = await qsbRecoveryHarness();
    expect(await recovery.vaults()).toEqual([]);
    recovery.restored.events.length = 0;
    const reply = await recovery.recover();
    expect(reply["ok"]).toBe(true);
    expect(vaultsOf(reply)).toEqual([
      {
        deposit: {
          amountSat: WITHDRAWN_DEPOSIT_SAT,
          confirmations: null,
          status: "confirmed",
          txid: recovery.writer.depositTxid,
        },
        registered: true,
        state: "unknown",
        v: 0,
        withdrawal: {
          confirmations: null,
          destination: DESTINATION,
          feeSat: recovery.quote.feeSat,
          outputSat: recovery.quote.outputSat,
          status: "ready",
          txid: null,
        },
      },
    ]);
    const { events } = recovery.restored;
    expect(indexOf(events, JOURNAL_KEY)).toBeGreaterThanOrEqual(0);
    expect(indexOf(events, JOURNAL_KEY)).toBeLessThan(indexOf(events, WITHDRAWAL_KEY));
    // The coordinator's search was never asked to start again.
    expect(events).not.toContain("call POST /v1/jobs");
  });

  test("running it again changes nothing", async () => {
    const recovery = await qsbRecoveryHarness();
    const first = await recovery.recover();
    recovery.restored.events.length = 0;
    expect(await recovery.recover()).toEqual(first);
    expect(recovery.restored.events.filter((event) => event.startsWith("write "))).toEqual([]);
  });

  test("adopts a search still running, as searching", async () => {
    const recovery = await qsbRecoveryHarness({ solved: false });
    const [vault] = vaultsOf(await recovery.recover());
    expect(vault).toMatchObject({ state: "unknown", withdrawal: { status: "searching" } });
  });

  test("a deposit /funding does not confirm is recorded without funding or withdrawal", async () => {
    const recovery = await qsbRecoveryHarness();
    recovery.writer.state.confirmed.delete(recovery.writer.depositTxid);
    const [vault] = vaultsOf(await recovery.recover());
    expect(vault).toMatchObject({
      deposit: { status: "submitted" },
      state: "unknown",
      withdrawal: { status: "none" },
    });
  });

  test("ignores a coordinator vault no index of this phrase built", async () => {
    const recovery = await qsbRecoveryHarness();
    const [own] = recovery.writer.state.vaults.values();
    const { funding: _funded, ...unfunded } = own?.vault ?? {};
    const foreignScript = `${"51".repeat(99)}ac`;
    recovery.writer.state.vaults.set("31111111-2222-4333-8444-000000000077", {
      raw: null,
      vault: {
        ...unfunded,
        id: "31111111-2222-4333-8444-000000000077",
        scriptHash: createHash("sha256").update(Buffer.from(foreignScript, "hex")).digest("hex"),
        scriptHex: foreignScript,
        status: "unfunded",
      },
    });
    const vaults = vaultsOf(await recovery.recover());
    expect(vaults.map(({ state, v }) => ({ state, v }))).toEqual([{ state: "unknown", v: 0 }]);
  });
});

describe("a recovered job that does not check out is not adopted", () => {
  test.each([
    [
      "a manifest hash that is not the manifest's",
      { rehash: false },
      () => ({ manifestHash: "ee".repeat(32) }),
    ],
    [
      "a manifest naming another vault",
      {},
      (job: { manifest: Record<string, unknown> }) => ({
        manifest: { ...job.manifest, vaultId: "31111111-2222-4333-8444-000000000099" },
      }),
    ],
    [
      "a manifest naming other funding",
      {},
      (job: { manifest: Record<string, unknown> }) => ({
        manifest: {
          ...job.manifest,
          funding: {
            ...(job.manifest["funding"] as object),
            value: String(WITHDRAWN_DEPOSIT_SAT + 1),
          },
        },
      }),
    ],
    [
      "a destination its output script does not pay",
      {},
      (job: { manifest: Record<string, unknown> }) => ({
        manifest: { ...job.manifest, destination: OTHER_DESTINATION },
      }),
    ],
    [
      "a payout that is not the deposit plus the helper less the fee",
      {},
      (job: { manifest: Record<string, unknown> }) => ({
        manifest: {
          ...job.manifest,
          outputValue: String(Number(job.manifest["outputValue"]) + 1),
        },
      }),
    ],
    ["a submitted job", {}, () => ({ status: "submitted", txid: "ab".repeat(32) })],
    ["a failed job", {}, () => ({ status: "failed" })],
  ] as const)("%s", async (_label, options, edit) => {
    const recovery = await qsbRecoveryHarness();
    recovery.editJob(edit as never, options);
    const [vault] = vaultsOf(await recovery.recover());
    expect(vault?.state).toBe("unknown");
    expect(vault?.deposit.status).toBe("confirmed");
    expect(vault?.withdrawal.status).toBe("none");
  });
});

describe("the emergency release of a recovered withdrawal", () => {
  test("reviews as emergency, releases only as emergency, and leaves the deposit unknown", async () => {
    const recovery = await qsbRecoveryHarness();
    await recovery.recover();
    const { review } = (await recovery.review()) as { readonly review: QsbWithdrawalReview };
    expect(review).toMatchObject({
      custody: "emergency",
      destination: DESTINATION,
      feeSat: recovery.quote.feeSat,
      outputSat: recovery.quote.outputSat,
    });
    expect(await recovery.release(review.digest, false)).toEqual({
      error: QSB_WITHDRAWAL_REFUSALS.custodyChanged,
    });
    expect(recovery.restored.runtime.finished).toEqual([]);
    const released = await recovery.release(review.digest, true);
    expect(released).toMatchObject({ ok: true, submission: "submitted" });
    expect(released["vault"]).toMatchObject({
      state: "unknown",
      withdrawal: { status: "submitted" },
    });
    expect(recovery.restored.runtime.finished).toHaveLength(15);
    const [vault] = await recovery.vaults();
    expect(vault).toMatchObject({ state: "unknown", withdrawal: { status: "submitted" } });
  });

  test("the writer's review stays conformant and refuses an emergency release", async () => {
    const recovery = await qsbRecoveryHarness();
    const review = await recovery.writer.review();
    expect(review.custody).toBe("conformant");
    expect(await recovery.writer.release(review.digest, undefined, true)).toEqual({
      error: QSB_WITHDRAWAL_REFUSALS.custodyChanged,
    });
    expect(recovery.writer.runtime.finished).toEqual([]);
  });
});

describe("recovery refuses", () => {
  test("the writer, which needs none", async () => {
    const recovery = await qsbRecoveryHarness();
    recovery.writer.events.length = 0;
    expect(
      await recovery.writer.send({ accountId: "qsb-1", type: "wallet.recoverQsbVaults" }),
    ).toEqual({ error: QSB_VAULT_REFUSALS.recoveryNotNeeded });
    expect(recovery.writer.events.filter((event) => event.startsWith("write "))).toEqual([]);
  });

  test("without the coordinator grant, asking nothing and writing nothing", async () => {
    const recovery = await qsbRecoveryHarness();
    recovery.restored.grant(false);
    recovery.restored.events.length = 0;
    expect(await recovery.recover()).toEqual({ error: QSB_VAULT_REFUSALS.accessNeeded });
    expect(recovery.restored.events).toEqual([]);
  });
});
