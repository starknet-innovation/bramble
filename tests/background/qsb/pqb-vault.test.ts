/** Real Krusty and pinned SDK creation/deposit journey; coordinator replies remain untrusted. */
import { describe, expect, test } from "bun:test";
import { qsbWithdrawalFeeSat } from "@bramble/qsb/fees";
import { QSB_VAULT_REFUSALS } from "@bramble/wallet-model/qsb-vaults";
import { paymentToAddress } from "../../support/qsb-coordinator-fake";
import { qsbVaultHarness } from "../../support/qsb-vault-harness";

const create = { accountId: "qsb-1", type: "wallet.createQsbVault" };
describe("PQB vault integration", () => {
  test("registers and funds a PQB script without giving the service its spending material", async () => {
    const h = await qsbVaultHarness({ protocol: "PQB", funds: [300000] });
    const created = await h.send(create);
    expect(created).toHaveProperty("vault");
    const [entry] = h.state.vaults.values();
    const server = entry?.vault;
    expect(server?.["config"]).toBe("PQB");
    expect(server?.["configuration"]).toMatchObject({ protocol: "pqb-v1" });
    const quote = (await h.send({
      accountId: "qsb-1",
      v: 0,
      amountSat: 100000,
      type: "wallet.quoteQsbDeposit",
    })) as { quote: { feeSat: number; withdrawalFeeSat: number } };
    expect(quote.quote.withdrawalFeeSat).toBe(Number(qsbWithdrawalFeeSat(2000n, "PQB")));
    const deposited = (await h.send({
      accountId: "qsb-1",
      v: 0,
      amountSat: 100000,
      feeSat: quote.quote.feeSat,
      type: "wallet.depositQsbVault",
    })) as { vault: { deposit: { txid: string } } };
    h.state.confirmed.add(deposited.vault.deposit.txid);
    await h.send({ accountId: "qsb-1", type: "wallet.qsbVaults" });
    h.state.utxos = paymentToAddress(h.owner, [2000], "PQB helper");
    const withdrawal = {
      accountId: "qsb-1",
      v: 0,
      destination: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
      type: "wallet.quoteQsbWithdrawal",
    };
    // Config A serving cannot create a PQB intent, even though deposits work.
    expect(await h.send(withdrawal)).toEqual({ error: QSB_VAULT_REFUSALS.coordinatorDisabled });
    h.state.config["solverProtocol"] = "pqb-v1";
    const answer = await h.send(withdrawal);
    expect(answer).toHaveProperty("quote");
    expect(JSON.stringify(server)).not.toContain('"seed"');
  });
});
