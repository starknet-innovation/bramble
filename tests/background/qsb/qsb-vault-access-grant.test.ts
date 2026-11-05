/**
 * The coordinator's origin is an optional host permission the user grants at
 * runtime, and the background asks the browser before any coordinator
 * request. Without the grant, create, quote, deposit and resend refuse with
 * `accessNeeded` before anything is allocated, kept or sent, and the listing
 * answers with the local vaults and nothing claimed, sending nothing. The
 * browser check asks for exactly `QSB_COORDINATOR_PERMISSION` and fails
 * closed.
 */
import { describe, expect, test } from "bun:test";
import type { QsbDepositQuote } from "@bramble/wallet-model/qsb-vaults";
import { QSB_COORDINATOR_PERMISSION, QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { qsbCoordinatorAccess } from "../../../apps/extension/src/background/qsb/qsb-vault-access-grant";
import { QSB_HARNESS_PASSPHRASE, qsbVaultHarness } from "../../support/qsb-vault-harness";

const CREATE = { accountId: "qsb-1", type: "wallet.createQsbVault" } as const;
const LIST = { accountId: "qsb-1", type: "wallet.qsbVaults" } as const;
const QUOTE = {
  accountId: "qsb-1",
  amountSat: 50_000,
  type: "wallet.quoteQsbDeposit",
  v: 0,
} as const;
const ACCESS_NEEDED = { error: QSB_VAULT_REFUSALS.accessNeeded };

describe("the coordinator grant", () => {
  test("asks the browser for exactly the coordinator's pattern, and fails closed", async () => {
    const asked: unknown[] = [];
    const granted = qsbCoordinatorAccess({
      contains: async (permissions) => {
        asked.push(permissions);
        return true;
      },
    });
    expect(await granted()).toBe(true);
    expect(asked).toEqual([{ origins: [QSB_COORDINATOR_PERMISSION] }]);
    expect(await qsbCoordinatorAccess(undefined)()).toBe(false);
    expect(await qsbCoordinatorAccess({})()).toBe(false);
    expect(
      await qsbCoordinatorAccess({
        contains: async () => {
          throw new Error("permissions unavailable");
        },
      })(),
    ).toBe(false);
  });

  test("without it, a create refuses before anything is allocated or sent", async () => {
    const harness = await qsbVaultHarness();
    harness.grant(false);
    expect(await harness.send(CREATE)).toEqual(ACCESS_NEEDED);
    expect(harness.state.calls).toEqual([]);
    expect(harness.events.filter((event) => event.startsWith("write"))).toEqual([]);
    const journal = await harness.service.withQsbVaultAccount(
      { accountId: "qsb-1", vaultPassphrase: QSB_HARNESS_PASSPHRASE },
      (access) => access.journal(),
    );
    expect(journal).toMatchObject({ nextV: 0, vaults: [] });
  }, 60_000);

  test("without it, quote, deposit and resend refuse and nothing is kept or sent", async () => {
    const harness = await qsbVaultHarness({ funds: [300_000] });
    await harness.send(CREATE);
    const { feeSat } = ((await harness.send(QUOTE)) as { readonly quote: QsbDepositQuote }).quote;
    harness.grant(false);
    harness.state.calls.length = 0;
    harness.events.length = 0;
    expect(await harness.send(QUOTE)).toEqual(ACCESS_NEEDED);
    expect(await harness.send({ ...QUOTE, feeSat, type: "wallet.depositQsbVault" })).toEqual(
      ACCESS_NEEDED,
    );
    expect(
      await harness.send({ accountId: "qsb-1", type: "wallet.resendQsbDeposit", v: 0 }),
    ).toEqual(ACCESS_NEEDED);
    expect(harness.state.calls).toEqual([]);
    expect(harness.events.filter((event) => event.startsWith("write"))).toEqual([]);
  }, 60_000);

  test("without it, the listing answers with the local vaults and asks the coordinator nothing", async () => {
    const harness = await qsbVaultHarness({ funds: [300_000] });
    await harness.send(CREATE);
    harness.grant(false);
    harness.state.calls.length = 0;
    expect(await harness.send(LIST)).toEqual({
      address: harness.owner,
      funds: null,
      ok: true,
      vaults: [
        {
          deposit: { amountSat: null, confirmations: null, status: "none", txid: null },
          registered: null,
          state: "allocated",
          v: 0,
          withdrawal: {
            confirmations: null,
            destination: null,
            feeSat: null,
            outputSat: null,
            status: "none",
            txid: null,
          },
        },
      ],
    });
    expect(harness.state.calls).toEqual([]);
    harness.grant(true);
    expect(await harness.send(LIST)).toMatchObject({ funds: { totalSat: 300_000 } });
  }, 60_000);
});
