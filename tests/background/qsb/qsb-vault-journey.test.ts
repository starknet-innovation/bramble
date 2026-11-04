/**
 * The QSB vault journey through the real background router, vault service
 * and Krusty, against the stand-in coordinator: list, create, quote, deposit
 * and confirm, and the order of every durable write against every request —
 * the vault allocated before anything is sent, its script recorded before it
 * is registered, the signed bytes kept before they are submitted, and the
 * funding recorded only once the chain confirms it.
 */
import { describe, expect, test } from "bun:test";
import type { QsbDepositQuote, QsbVaultView } from "@bramble/wallet-model/qsb-vaults";
import { Transaction } from "@scure/btc-signer";
import { QSB_HARNESS_PASSPHRASE, qsbVaultHarness } from "../../support/qsb-vault-harness";

const JOURNAL_KEY = /^write bramble:qsb-journal:/;
const DEPOSIT_KEY = /^write bramble:qsb-deposit:/;

type Listing = {
  readonly address: string;
  readonly funds: { readonly totalSat: number; readonly utxoCount: number } | null;
  readonly ok: true;
  readonly vaults: readonly QsbVaultView[];
};

const indexOf = (events: readonly string[], match: RegExp | string): number =>
  events.findIndex((event) => (typeof match === "string" ? event === match : match.test(event)));

describe("the QSB vault journey", () => {
  test("lists, creates, quotes, deposits and confirms a vault", async () => {
    const harness = await qsbVaultHarness({ funds: [300_000, 20_000] });
    const listed = (await harness.send({
      accountId: "qsb-1",
      type: "wallet.qsbVaults",
    })) as Listing;
    expect(listed).toEqual({
      address: harness.owner,
      funds: { totalSat: 320_000, utxoCount: 2 },
      ok: true,
      vaults: [],
    });
    expect(harness.owner).toMatch(/^bc1q/);

    harness.events.length = 0;
    const created = await harness.send({ accountId: "qsb-1", type: "wallet.createQsbVault" });
    expect(created).toEqual({
      ok: true,
      vault: {
        deposit: { amountSat: null, confirmations: null, status: "none", txid: null },
        registered: true,
        state: "allocated",
        v: 0,
      },
    });
    // Allocated, then associated, both durable before the registration is sent.
    const writes = harness.events.filter((event) => JOURNAL_KEY.test(event));
    expect(writes).toHaveLength(2);
    const lastJournalWrite = harness.events.lastIndexOf(writes[1] ?? "");
    // Before the allocation only public requests go out: no commitment or script.
    expect(harness.events.slice(0, indexOf(harness.events, JOURNAL_KEY))).toEqual([
      "call GET /v1/config",
      "call GET /v1/vaults",
    ]);
    expect(lastJournalWrite).toBeLessThan(indexOf(harness.events, "call POST /v1/vaults"));
    const [registered] = [...harness.state.vaults.values()];
    expect(registered?.vault["paymentAddress"]).toBe(harness.owner);
    expect(registered?.vault).not.toHaveProperty("funding");

    const quote = (await harness.send({
      accountId: "qsb-1",
      amountSat: 50_000,
      type: "wallet.quoteQsbDeposit",
      v: 0,
    })) as { readonly ok: true; readonly quote: QsbDepositQuote };
    // One input (the largest), change back, MARA's 2 sat/vB floor.
    expect(quote.quote).toMatchObject({ amountSat: 50_000, feeRate: "2", inputCount: 1 });
    expect(quote.quote.changeSat).toBe(300_000 - 50_000 - quote.quote.feeSat);
    expect(quote.quote.feeSat).toBe(quote.quote.vsize * 2);
    expect(quote.quote.withdrawalFeeSat).toBeGreaterThan(0);

    harness.events.length = 0;
    const deposited = await harness.send({
      accountId: "qsb-1",
      amountSat: 50_000,
      feeSat: quote.quote.feeSat,
      type: "wallet.depositQsbVault",
      v: 0,
    });
    const submittedTx = registered?.raw ?? "";
    const tx = Transaction.fromRaw(Buffer.from(submittedTx, "hex"), { allowUnknownOutputs: true });
    expect(deposited).toEqual({
      ok: true,
      submission: "submitted",
      vault: {
        deposit: { amountSat: 50_000, confirmations: null, status: "submitted", txid: tx.id },
        registered: true,
        state: "allocated",
        v: 0,
      },
    });
    // The signed bytes are kept before they are sent, and dropped once MARA has them.
    const kept = indexOf(harness.events, DEPOSIT_KEY);
    const sent = indexOf(harness.events, /^call POST \/v1\/vaults\/[0-9a-f-]+\/fund\/submit$/);
    expect(kept).toBeGreaterThanOrEqual(0);
    expect(kept).toBeLessThan(sent);
    expect(harness.events.slice(sent).some((event) => DEPOSIT_KEY.test(event))).toBe(true);
    expect(tx.getOutput(0).amount).toBe(50_000n);
    expect(Buffer.from(tx.getOutput(0).script ?? []).toString("hex")).toBe(
      String(registered?.vault["scriptHex"]),
    );

    // Submitted, not yet mined: the listing does not record it.
    const pendingList = (await harness.send({
      accountId: "qsb-1",
      type: "wallet.qsbVaults",
    })) as Listing;
    expect(pendingList.vaults[0]?.deposit.status).toBe("submitted");
    const unconfirmed = await harness.service.withQsbVaultAccount(
      { accountId: "qsb-1", vaultPassphrase: QSB_HARNESS_PASSPHRASE },
      (access) => access.journal(),
    );
    expect(unconfirmed.status === "bound" && unconfirmed.vaults[0]?.funding).toBeNull();

    harness.state.confirmed.add(tx.id);
    const confirmedList = (await harness.send({
      accountId: "qsb-1",
      type: "wallet.qsbVaults",
    })) as Listing;
    expect(confirmedList.vaults).toEqual([
      {
        deposit: { amountSat: 50_000, confirmations: 1, status: "confirmed", txid: tx.id },
        registered: true,
        state: "allocated",
        v: 0,
      },
    ]);
    const journal = await harness.service.withQsbVaultAccount(
      { accountId: "qsb-1", vaultPassphrase: QSB_HARNESS_PASSPHRASE },
      (access) => access.journal(),
    );
    expect(journal.status === "bound" && journal.vaults[0]?.funding).toEqual({
      txid: tx.id,
      valueSat: 50_000,
      vout: 0,
    });
    // A confirmed vault takes no second deposit.
    expect(
      await harness.send({
        accountId: "qsb-1",
        amountSat: 50_000,
        type: "wallet.quoteQsbDeposit",
        v: 0,
      }),
    ).toEqual({ error: "qsb vault cannot take a deposit" });
  }, 60_000);

  test("signs in once and reuses the session until it expires", async () => {
    const harness = await qsbVaultHarness({ funds: [100_000] });
    await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" });
    await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" });
    expect(harness.state.calls.filter((call) => call === "POST /auth/verify")).toHaveLength(1);
    harness.setNow(Date.UTC(2026, 10, 4, 13, 0, 0));
    await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" });
    expect(harness.state.calls.filter((call) => call === "POST /auth/verify")).toHaveLength(2);
    // A token the coordinator no longer knows is replaced once.
    harness.state.tokens.clear();
    const listing = (await harness.send({
      accountId: "qsb-1",
      type: "wallet.qsbVaults",
    })) as Listing;
    expect(listing.funds).toEqual({ totalSat: 100_000, utxoCount: 1 });
    expect(harness.state.calls.filter((call) => call === "POST /auth/verify")).toHaveLength(3);
  }, 60_000);

  test("lists the local vaults with nothing unknown claimed when the coordinator is down", async () => {
    const harness = await qsbVaultHarness({ funds: [100_000] });
    await harness.send({ accountId: "qsb-1", type: "wallet.createQsbVault" });
    harness.state.refusals.set("GET /payment-utxos", { code: "chain_unavailable", status: 503 });
    expect(await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" })).toEqual({
      address: harness.owner,
      funds: null,
      ok: true,
      vaults: [
        {
          deposit: { amountSat: null, confirmations: null, status: "none", txid: null },
          registered: null,
          state: "allocated",
          v: 0,
        },
      ],
    });
  }, 60_000);
});
