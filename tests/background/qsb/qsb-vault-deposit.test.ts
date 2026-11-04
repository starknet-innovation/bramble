/**
 * Depositing into a QSB vault, refusal by refusal and outcome by outcome,
 * through the real router, vault service and Krusty: every refusal comes
 * before the signed bytes are kept and sends nothing to `fund/submit`; once
 * kept, the answer is always a submission, `uncertain` (still pending) unless
 * the coordinator's answer is about this vault and these bytes; a pending
 * deposit refuses another and is resent byte for byte; a rejection ends it;
 * and a resend with nothing kept asks the coordinator for its own bytes.
 */
import { describe, expect, test } from "bun:test";
import type { QsbDepositQuote } from "@bramble/wallet-model/qsb-vaults";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { QSB_HARNESS_PASSPHRASE, qsbVaultHarness } from "../../support/qsb-vault-harness";

type Harness = Awaited<ReturnType<typeof qsbVaultHarness>>;

const QUOTE = {
  accountId: "qsb-1",
  amountSat: 50_000,
  type: "wallet.quoteQsbDeposit",
  v: 0,
} as const;
const RESEND = { accountId: "qsb-1", type: "wallet.resendQsbDeposit", v: 0 } as const;

// A wallet with vault 0 registered and the owner funded.
const withVault = async (funds: readonly number[] = [300_000]): Promise<Harness> => {
  const harness = await qsbVaultHarness({ funds });
  await harness.send({ accountId: "qsb-1", type: "wallet.createQsbVault" });
  return harness;
};

const quoteOf = async (harness: Harness, amountSat = 50_000): Promise<QsbDepositQuote> => {
  const reply = (await harness.send({ ...QUOTE, amountSat })) as {
    readonly quote: QsbDepositQuote;
  };
  return reply.quote;
};

const deposit = async (harness: Harness, feeSat: number, amountSat = 50_000) =>
  harness.send({ ...QUOTE, amountSat, feeSat, type: "wallet.depositQsbVault" });

const submits = (harness: Harness): number =>
  harness.state.calls.filter((call) => call === "POST /vaults/:id/fund/submit").length;

const pending = (harness: Harness) =>
  harness.service.withQsbVaultAccount(
    { accountId: "qsb-1", vaultPassphrase: QSB_HARNESS_PASSPHRASE },
    (access) => access.pendingDeposits(),
  );

describe("QSB deposit refusals, all before anything is kept or sent", () => {
  test("amountTooSmall, unknownVault, insufficientFunds and quoteChanged", async () => {
    const harness = await withVault([30_000]);
    expect(await harness.send({ ...QUOTE, amountSat: 9_999 })).toEqual({
      error: QSB_VAULT_REFUSALS.amountTooSmall,
    });
    expect(await harness.send({ ...QUOTE, v: 3 })).toEqual({
      error: QSB_VAULT_REFUSALS.unknownVault,
    });
    expect(await harness.send({ ...QUOTE, amountSat: 20_000 })).toEqual({
      error: QSB_VAULT_REFUSALS.insufficientFunds,
    });
    const fee = (await quoteOf(harness, 10_000)).feeSat;
    expect(await deposit(harness, fee + 1, 10_000)).toEqual({
      error: QSB_VAULT_REFUSALS.quoteChanged,
    });
    expect(submits(harness)).toBe(0);
    expect(await pending(harness)).toEqual([]);
  }, 60_000);

  test("coordinatorDisabled and minerRateUnavailable", async () => {
    const harness = await withVault();
    harness.state.config = { ...harness.state.config, exactSubmitEnabled: false };
    expect(await harness.send(QUOTE)).toEqual({ error: QSB_VAULT_REFUSALS.coordinatorDisabled });
    harness.state.config = {
      ...harness.state.config,
      exactSubmitEnabled: true,
      operationsEnabled: false,
    };
    expect(await harness.send(QUOTE)).toEqual({ error: QSB_VAULT_REFUSALS.coordinatorDisabled });
    harness.state.config = { ...harness.state.config, operationsEnabled: true };
    harness.state.refusals.set("GET /rates", { code: "miner_rate_unavailable", status: 503 });
    expect(await harness.send(QUOTE)).toEqual({ error: QSB_VAULT_REFUSALS.minerRateUnavailable });
    expect(submits(harness)).toBe(0);
  }, 60_000);

  test("a floor that rises between quote and deposit is quoteChanged", async () => {
    const harness = await withVault();
    const quote = await quoteOf(harness);
    harness.state.rates = { market_rate: 3, submit_fee_rate: 2 };
    expect(await deposit(harness, quote.feeSat)).toEqual({
      error: QSB_VAULT_REFUSALS.quoteChanged,
    });
    expect(await pending(harness)).toEqual([]);
  }, 60_000);

  test("an unregistered vault, or one that takes no deposit, is notDepositable", async () => {
    const harness = await qsbVaultHarness({ funds: [300_000] });
    harness.state.refusals.set("POST /vaults", { code: "chain_unavailable", status: 503 });
    await harness.send({ accountId: "qsb-1", type: "wallet.createQsbVault" });
    expect(await harness.send(QUOTE)).toEqual({ error: QSB_VAULT_REFUSALS.notDepositable });
  }, 60_000);

  test("a refused sign-in is signInRefused", async () => {
    const harness = await withVault();
    harness.deps.sessions.clear();
    harness.state.refusals.set("POST /auth/verify", { code: "signature_invalid", status: 401 });
    expect(await harness.send(QUOTE)).toEqual({ error: QSB_VAULT_REFUSALS.signInRefused });
  }, 60_000);
});

describe("QSB deposit outcomes", () => {
  test("uncertain keeps the bytes pending: another deposit is refused, a resend sends the same bytes", async () => {
    const harness = await withVault();
    const quote = await quoteOf(harness);
    harness.state.refusals.set("POST /vaults/:id/fund/submit", {
      code: "miner_unavailable",
      status: 503,
    });
    const uncertain = (await deposit(harness, quote.feeSat)) as Record<string, unknown>;
    expect(uncertain).toMatchObject({
      ok: true,
      submission: "uncertain",
      vault: { deposit: { amountSat: 50_000, status: "pending" }, state: "allocated", v: 0 },
    });
    const [kept] = (await pending(harness)) ?? [];
    expect(kept?.txid).toMatch(/^[0-9a-f]{64}$/);
    expect(await deposit(harness, quote.feeSat)).toEqual({
      error: QSB_VAULT_REFUSALS.depositPending,
    });
    expect(await harness.send({ accountId: "qsb-1", type: "wallet.qsbVaults" })).toMatchObject({
      vaults: [{ deposit: { status: "pending", txid: kept?.txid } }],
    });

    harness.state.refusals.clear();
    expect(await harness.send(RESEND)).toMatchObject({
      ok: true,
      submission: "submitted",
      vault: { deposit: { status: "submitted", txid: kept?.txid } },
    });
    expect([...harness.state.vaults.values()][0]?.raw).toBe(kept?.rawTxHex ?? "");
    expect(await pending(harness)).toEqual([]);
  }, 60_000);

  test("a transport failure after the bytes are kept is uncertain, never a refusal", async () => {
    const harness = await withVault();
    const quote = await quoteOf(harness);
    const submit = harness.deps.coordinator.fundSubmit;
    Object.assign(harness.deps.coordinator, {
      fundSubmit: async () => {
        throw new TypeError("network down");
      },
    });
    expect(await deposit(harness, quote.feeSat)).toMatchObject({
      ok: true,
      submission: "uncertain",
    });
    Object.assign(harness.deps.coordinator, { fundSubmit: submit });
    expect((await pending(harness))?.length).toBe(1);
  }, 60_000);

  test("rejected ends the pending deposit and the vault takes a new one", async () => {
    const harness = await withVault();
    const quote = await quoteOf(harness);
    harness.state.submission = "rejected";
    expect(await deposit(harness, quote.feeSat)).toEqual({
      ok: true,
      submission: "rejected",
      vault: {
        deposit: { amountSat: null, confirmations: null, status: "none", txid: null },
        registered: true,
        state: "allocated",
        v: 0,
      },
    });
    expect(await pending(harness)).toEqual([]);
    harness.state.submission = "submitted";
    expect(await deposit(harness, quote.feeSat)).toMatchObject({ submission: "submitted" });
  }, 60_000);

  test("an answer about another vault, or other bytes, is uncertain", async () => {
    const harness = await withVault();
    const quote = await quoteOf(harness);
    const submit = harness.deps.coordinator.fundSubmit;
    Object.assign(harness.deps.coordinator, {
      fundSubmit: async (...args: Parameters<typeof submit>) => {
        const answer = await submit(...args);
        return {
          ...answer,
          vault: { ...answer.vault, funding: { txid: "ee".repeat(32), valueSat: 1, vout: 0 } },
        };
      },
    });
    expect(await deposit(harness, quote.feeSat)).toMatchObject({ submission: "uncertain" });
    expect((await pending(harness))?.length).toBe(1);
  }, 60_000);

  test("a resend with nothing kept asks the coordinator for its own bytes", async () => {
    const harness = await withVault();
    await deposit(harness, (await quoteOf(harness)).feeSat);
    expect(await harness.send(RESEND)).toMatchObject({
      ok: true,
      submission: "submitted",
      vault: { deposit: { amountSat: 50_000, status: "submitted" } },
    });
    expect(harness.state.calls).toContain("POST /vaults/:id/fund/resubmit");
  }, 60_000);

  test("a resend before any deposit is notDepositable", async () => {
    const harness = await withVault();
    expect(await harness.send(RESEND)).toEqual({ error: QSB_VAULT_REFUSALS.notDepositable });
  }, 60_000);
});
