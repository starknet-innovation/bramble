/**
 * QSB flows never hold the vault service's queue across the network or a
 * runtime run, and one account's flows still never interleave. While a
 * deposit waits on `fund/submit`, or a create waits on the Pyodide runtime,
 * Starknet vault work (status, vault reads, the QSB account list) completes;
 * and two concurrent flows of one account run one after the other under its
 * QSB lock: two creates allocate consecutive indices, two deposits into one
 * vault reach `fund/submit` once.
 */
import { describe, expect, test } from "bun:test";
import type { QsbDepositQuote } from "@bramble/wallet-model/qsb-vaults";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { createQsbAccountLocks } from "../../../apps/extension/src/background/qsb/qsb-vault-locks";
import { QSB_HARNESS_PASSPHRASE, qsbVaultHarness } from "../../support/qsb-vault-harness";

const CREATE = { accountId: "qsb-1", type: "wallet.createQsbVault" } as const;
const QUOTE = {
  accountId: "qsb-1",
  amountSat: 50_000,
  type: "wallet.quoteQsbDeposit",
  v: 0,
} as const;

// A promise to hold a step open, and the call that lets it go.
const gate = () => {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

// Resolves once `check` holds, polling the event loop.
const until = async (check: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 500 && !check(); tries += 1) await Bun.sleep(5);
  if (!check()) throw new Error("condition never held");
};

describe("the per-account QSB lock", () => {
  test("runs one account's tasks one at a time, other accounts' alongside, past failures", async () => {
    const locks = createQsbAccountLocks();
    const order: string[] = [];
    const held = gate();
    const first = locks.run("qsb-1", async () => {
      order.push("qsb-1 first starts");
      await held.opened;
      order.push("qsb-1 first ends");
      throw new Error("first failed");
    });
    const second = locks.run("qsb-1", async () => {
      order.push("qsb-1 second");
      return 2;
    });
    const other = locks.run("qsb-2", async () => {
      order.push("qsb-2");
      return 3;
    });
    expect(await other).toBe(3);
    held.open();
    await expect(first).rejects.toThrow("first failed");
    expect(await second).toBe(2);
    expect(order).toEqual(["qsb-1 first starts", "qsb-2", "qsb-1 first ends", "qsb-1 second"]);
  });
});

describe("QSB flows and the vault queue", () => {
  test("Starknet vault work completes while a deposit waits on fund/submit", async () => {
    const harness = await qsbVaultHarness({ funds: [300_000] });
    await harness.send(CREATE);
    const { feeSat } = ((await harness.send(QUOTE)) as { readonly quote: QsbDepositQuote }).quote;
    const held = gate();
    let submitting = false;
    const submit = harness.deps.coordinator.fundSubmit;
    Object.assign(harness.deps.coordinator, {
      fundSubmit: async (...args: Parameters<typeof submit>) => {
        submitting = true;
        await held.opened;
        return submit(...args);
      },
    });
    const deposit = harness.send({ ...QUOTE, feeSat, type: "wallet.depositQsbVault" });
    await until(() => submitting);

    // The deposit holds its account's lock, not the vault's queue.
    expect(await harness.send({ type: "wallet.status" })).toMatchObject({ hasVault: true });
    expect((await harness.service.readVault(QSB_HARNESS_PASSPHRASE)).qsbAccounts).toHaveLength(1);
    expect(await harness.send({ type: "wallet.qsbAccounts" })).toMatchObject({ ok: true });
    expect(submitting).toBe(true);

    held.open();
    expect(await deposit).toMatchObject({ ok: true, submission: "submitted" });
  }, 60_000);

  test("Starknet vault work completes while a create waits on the runtime", async () => {
    const harness = await qsbVaultHarness();
    const held = gate();
    let building = false;
    const setup = harness.runtime.setupFromCommitments;
    harness.runtime.setupFromCommitments = async (commitments) => {
      building = true;
      await held.opened;
      return setup(commitments);
    };
    const create = harness.send(CREATE);
    await until(() => building);
    expect(await harness.send({ type: "wallet.status" })).toMatchObject({ hasVault: true });
    expect((await harness.service.readVault(QSB_HARNESS_PASSPHRASE)).qsbAccounts).toHaveLength(1);
    held.open();
    expect(await create).toMatchObject({ ok: true, vault: { v: 0 } });
  }, 60_000);

  test("two concurrent creates on one account allocate consecutive indices", async () => {
    const harness = await qsbVaultHarness();
    const [first, second] = await Promise.all([harness.send(CREATE), harness.send(CREATE)]);
    expect([first, second]).toEqual([
      expect.objectContaining({ vault: expect.objectContaining({ registered: true, v: 0 }) }),
      expect.objectContaining({ vault: expect.objectContaining({ registered: true, v: 1 }) }),
    ]);
    expect(harness.state.calls.filter((call) => call === "POST /vaults")).toHaveLength(2);
    expect(
      new Set([...harness.state.vaults.values()].map((entry) => entry.vault["scriptHash"])).size,
    ).toBe(2);
  }, 60_000);

  test("two concurrent deposits into one vault reach fund/submit once", async () => {
    const harness = await qsbVaultHarness({ funds: [300_000] });
    await harness.send(CREATE);
    const { feeSat } = ((await harness.send(QUOTE)) as { readonly quote: QsbDepositQuote }).quote;
    const deposit = { ...QUOTE, feeSat, type: "wallet.depositQsbVault" };
    const [first, second] = await Promise.all([harness.send(deposit), harness.send(deposit)]);
    expect(first).toMatchObject({ ok: true, submission: "submitted" });
    expect(second).toEqual({ error: QSB_VAULT_REFUSALS.notDepositable });
    expect(
      harness.state.calls.filter((call) => call === "POST /vaults/:id/fund/submit"),
    ).toHaveLength(1);
  }, 60_000);
});
