/**
 * The QSB vault client against stubbed background replies:
 * each of the five messages is sent with exactly the contract's fields, every
 * reply is validated strictly (keys, types, satoshi ranges, the index, the
 * txid, the fee rate, the bech32 address, and each write's own rule), and a
 * refusal or a lost reply rejects the way the panel can tell apart.
 */
import { describe, expect, test } from "bun:test";
import {
  QSB_MAX_SAT,
  QSB_MAX_VAULTS_PER_ACCOUNT,
  QSB_VAULT_REFUSALS,
  type QsbVaultView,
} from "@bramble/wallet-model/qsb-vaults";
import { SubmissionUnknownError } from "@bramble/wallet-protocol/submission-unknown";
import {
  createQsbVaultClient,
  isQsbDepositQuote,
  isQsbOwnerAddress,
  isQsbVaultView,
  readQsbVaults,
} from "../../../../src/sidepanel/journeys/qsb/qsb-vault-runtime";
import { createSidepanelRuntime } from "../../../../src/sidepanel/runtime/runtime";
import { READ_ONLY_MESSAGES } from "../../../../src/sidepanel/runtime/runtime-errors";
import {
  depositedVault,
  depositResult,
  QSB_ADDRESS,
  QSB_TXID,
  QUOTE,
  unfundedVault,
  vaultsReply,
} from "../../../support/qsb-vault-fixtures";

const answering = (reply: unknown) => {
  const sent: unknown[] = [];
  const client = createQsbVaultClient(async (message) => {
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

describe("the owner address", () => {
  test("is a mainnet bech32 P2WPKH address, 42 lowercase characters", () => {
    expect(isQsbOwnerAddress(QSB_ADDRESS)).toBe(true);
    for (const address of [
      QSB_ADDRESS.toUpperCase(),
      QSB_ADDRESS.slice(0, -1),
      `${QSB_ADDRESS}q`,
      // Testnet, P2TR, and P2WSH are not the owner address.
      `tb1q${QSB_ADDRESS.slice(4)}`,
      `bc1p${QSB_ADDRESS.slice(4)}`,
      `bc1q${"q".repeat(58)}`,
      // b, i, o and 1 are outside the bech32 alphabet.
      `${QSB_ADDRESS.slice(0, -1)}b`,
      `${QSB_ADDRESS.slice(0, -1)}i`,
      `${QSB_ADDRESS.slice(0, -1)}o`,
      `${QSB_ADDRESS.slice(0, -1)}1`,
      ` ${QSB_ADDRESS}`,
      "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
      42,
    ]) {
      expect(isQsbOwnerAddress(address)).toBe(false);
    }
  });
});

describe("vault views", () => {
  test("accept each state and deposit status the contract names", () => {
    for (const vault of [
      unfundedVault(0),
      depositedVault(1, "pending"),
      depositedVault(2, "submitted"),
      depositedVault(3, "confirmed"),
      { ...unfundedVault(4), registered: null, state: "unknown" },
      { ...unfundedVault(5), registered: false, state: "retired" },
      { ...depositedVault(6, "confirmed"), state: "exposed" },
      { ...unfundedVault(Number.MAX_SAFE_INTEGER) },
      depositedVault(7, "confirmed", 0),
    ]) {
      expect(isQsbVaultView(vault)).toBe(true);
    }
  });

  test("refuse unknown or missing keys, wrong types, ranges and enums", () => {
    const vault = depositedVault(1, "confirmed");
    const { registered: _registered, ...missing } = vault;
    const deposit = (patch: Record<string, unknown>) => ({
      ...vault,
      deposit: { ...vault.deposit, ...patch },
    });
    for (const bad of [
      missing,
      { ...vault, script: "00" },
      { ...vault, v: -1 },
      { ...vault, v: 1.5 },
      { ...vault, v: Number.MAX_SAFE_INTEGER + 1 },
      { ...vault, v: "1" },
      { ...vault, state: "funded" },
      { ...vault, registered: "true" },
      deposit({ status: "mined" }),
      deposit({ amountSat: -1 }),
      deposit({ amountSat: QSB_MAX_SAT + 1 }),
      deposit({ amountSat: 1.5 }),
      deposit({ amountSat: "100000" }),
      deposit({ confirmations: -1 }),
      deposit({ txid: QSB_TXID.toUpperCase() }),
      deposit({ txid: QSB_TXID.slice(1) }),
      deposit({ txid: `0x${QSB_TXID.slice(2)}` }),
      deposit({ vout: 0 }),
      { ...vault, deposit: null },
      [vault],
      null,
    ]) {
      expect(isQsbVaultView(bad)).toBe(false);
    }
  });

  test("a reading holds at most the contract's vault cap", () => {
    const full = Array.from({ length: QSB_MAX_VAULTS_PER_ACCOUNT }, (_, v) => unfundedVault(v));
    expect(readQsbVaults(vaultsReply(full))?.vaults).toHaveLength(QSB_MAX_VAULTS_PER_ACCOUNT);
    expect(readQsbVaults(vaultsReply([...full, unfundedVault(QSB_MAX_VAULTS_PER_ACCOUNT)]))).toBe(
      null,
    );
  });

  test("a reading is read whole, with distinct indices, sorted by index", () => {
    const vaults = [depositedVault(2, "pending"), unfundedVault(0)];
    expect(readQsbVaults(vaultsReply(vaults))).toEqual({
      address: QSB_ADDRESS,
      funds: { totalSat: 250_000, utxoCount: 2 },
      vaults: [unfundedVault(0), depositedVault(2, "pending")],
    });
    expect(readQsbVaults({ ...vaultsReply([]), funds: null })?.funds).toBe(null);
    for (const bad of [
      { ...vaultsReply(), ok: false },
      { ...vaultsReply(), extra: 1 },
      { ...vaultsReply(), address: "bc1qshort" },
      { ...vaultsReply([unfundedVault(0), unfundedVault(0)]) },
      { ...vaultsReply(), vaults: [{ ...unfundedVault(0), state: "spent" }] },
      { ...vaultsReply(), vaults: {} },
      { ...vaultsReply(), funds: { totalSat: -1, utxoCount: 1 } },
      { ...vaultsReply(), funds: { totalSat: 1, utxoCount: 0 } },
      { ...vaultsReply(), funds: { totalSat: 1, utxoCount: 1, extra: 0 } },
      { ...vaultsReply(), funds: undefined },
    ]) {
      expect(readQsbVaults(bad)).toBe(null);
    }
  });
});

describe("deposit quotes", () => {
  test("accept a quote in range and refuse anything else", () => {
    expect(isQsbDepositQuote(QUOTE)).toBe(true);
    expect(isQsbDepositQuote({ ...QUOTE, changeSat: 0, feeRate: "2" })).toBe(true);
    for (const bad of [
      { ...QUOTE, feeRate: 2.5 },
      { ...QUOTE, feeRate: "2.5e0" },
      { ...QUOTE, feeRate: "-2" },
      { ...QUOTE, feeRate: "02" },
      { ...QUOTE, feeRate: `1.${"0".repeat(20)}` },
      { ...QUOTE, feeSat: -1 },
      { ...QUOTE, feeSat: 0.5 },
      { ...QUOTE, inputCount: 0 },
      { ...QUOTE, vsize: 0 },
      { ...QUOTE, amountSat: QSB_MAX_SAT, feeSat: 1 },
      { ...QUOTE, withdrawalFeeSat: QSB_MAX_SAT + 1 },
      { ...QUOTE, total: 1 },
      { ...QUOTE, changeSat: undefined },
    ]) {
      expect(isQsbDepositQuote(bad)).toBe(false);
    }
  });
});

describe("createQsbVaultClient", () => {
  test("sends each message with exactly its contract fields", async () => {
    const read = answering(vaultsReply());
    expect((await read.client.loadQsbVaults("qsb-2")).address).toBe(QSB_ADDRESS);
    expect(read.sent).toEqual([{ accountId: "qsb-2", type: "wallet.qsbVaults" }]);

    const created = answering({ ok: true, vault: unfundedVault(3) });
    expect(await created.client.createQsbVault("qsb-2")).toEqual(unfundedVault(3));
    expect(created.sent).toEqual([{ accountId: "qsb-2", type: "wallet.createQsbVault" }]);

    const quoted = answering({ ok: true, quote: QUOTE });
    expect(await quoted.client.quoteQsbDeposit("qsb-2", 0, 100_000)).toEqual(QUOTE);
    expect(quoted.sent).toEqual([
      { accountId: "qsb-2", amountSat: 100_000, type: "wallet.quoteQsbDeposit", v: 0 },
    ]);

    const deposited = answering({ ok: true, ...depositResult(0, "submitted") });
    expect(await deposited.client.depositQsbVault("qsb-2", 0, 100_000, 564)).toEqual(
      depositResult(0, "submitted"),
    );
    expect(deposited.sent).toEqual([
      { accountId: "qsb-2", amountSat: 100_000, feeSat: 564, type: "wallet.depositQsbVault", v: 0 },
    ]);

    const resent = answering({ ok: true, ...depositResult(1, "uncertain") });
    expect(await resent.client.resendQsbDeposit("qsb-2", 1)).toEqual(depositResult(1, "uncertain"));
    expect(resent.sent).toEqual([{ accountId: "qsb-2", type: "wallet.resendQsbDeposit", v: 1 }]);
  });

  test("a new vault must be allocated, registered and without a deposit", async () => {
    for (const vault of [
      { ...unfundedVault(0), registered: null },
      { ...unfundedVault(0), registered: false },
      { ...unfundedVault(0), state: "unknown" },
      depositedVault(0, "pending"),
    ] satisfies QsbVaultView[]) {
      const { client } = answering({ ok: true, vault });
      expect((await rejection(() => client.createQsbVault("qsb-2"))).message).toBe(
        "wallet request failed",
      );
    }
  });

  test("a quote must be for the amount asked", async () => {
    const { client } = answering({ ok: true, quote: QUOTE });
    expect((await rejection(() => client.quoteQsbDeposit("qsb-2", 0, 100_001))).message).toBe(
      "wallet unavailable",
    );
  });

  test("a deposit reply must be that vault, in the status its outcome implies", async () => {
    // The right vault, each outcome with its own status.
    for (const submission of ["rejected", "submitted", "uncertain"] as const) {
      const { client } = answering({ ok: true, ...depositResult(0, submission) });
      expect((await client.depositQsbVault("qsb-2", 0, 100_000, 564)).submission).toBe(submission);
    }
    // A submitted deposit may already be mined.
    const mined = answering({
      ok: true,
      submission: "submitted",
      vault: depositedVault(0, "confirmed"),
    });
    expect((await mined.client.resendQsbDeposit("qsb-2", 0)).vault.deposit.status).toBe(
      "confirmed",
    );
    for (const reply of [
      { ok: true, ...depositResult(1, "submitted") },
      { ok: true, submission: "submitted", vault: depositedVault(0, "pending") },
      { ok: true, submission: "uncertain", vault: depositedVault(0, "submitted") },
      { ok: true, submission: "rejected", vault: depositedVault(0, "pending") },
      {
        ok: true,
        submission: "submitted",
        vault: { ...depositedVault(0, "submitted"), state: "exposed" },
      },
      { ok: true, submission: "sent", vault: depositedVault(0, "submitted") },
      { ...depositResult(0, "submitted") },
      { ok: true, ...depositResult(0, "submitted"), txid: QSB_TXID },
    ]) {
      const { client } = answering(reply);
      expect(
        (await rejection(() => client.depositQsbVault("qsb-2", 0, 100_000, 564))).message,
      ).toBe("wallet request failed");
      expect((await rejection(() => client.resendQsbDeposit("qsb-2", 0))).message).toBe(
        "wallet request failed",
      );
    }
  });

  test("a refusal rejects with the background's diagnostic", async () => {
    type Client = ReturnType<typeof createQsbVaultClient>;
    for (const [run, diagnostic] of [
      [(c: Client) => c.loadQsbVaults("qsb-2"), QSB_VAULT_REFUSALS.runtimeUnavailable],
      [(c: Client) => c.createQsbVault("qsb-2"), QSB_VAULT_REFUSALS.notWriter],
      [(c: Client) => c.quoteQsbDeposit("qsb-2", 0, 1), QSB_VAULT_REFUSALS.amountTooSmall],
      [(c: Client) => c.depositQsbVault("qsb-2", 0, 1, 1), QSB_VAULT_REFUSALS.quoteChanged],
      [(c: Client) => c.resendQsbDeposit("qsb-2", 0), QSB_VAULT_REFUSALS.notDepositable],
    ] as const) {
      const { client } = answering({ error: diagnostic });
      expect((await rejection(() => run(client))).message).toBe(diagnostic);
    }
  });

  test("an unrecognised reply falls back to a read or an unknown-outcome code", async () => {
    const { client } = answering({ ok: true, surprise: 1 });
    expect((await rejection(() => client.loadQsbVaults("qsb-2"))).message).toBe(
      "wallet unavailable",
    );
    expect((await rejection(() => client.quoteQsbDeposit("qsb-2", 0, 1))).message).toBe(
      "wallet unavailable",
    );
    for (const write of [
      () => client.createQsbVault("qsb-2"),
      () => client.depositQsbVault("qsb-2", 0, 1, 1),
      () => client.resendQsbDeposit("qsb-2", 0),
    ]) {
      expect((await rejection(write)).message).toBe("wallet request failed");
    }
  });
});

describe("lost replies", () => {
  const lost = {
    sendMessage: () => Promise.reject(new Error("The message port closed before a response.")),
  };

  test("the vaults read and the quote are reads: a lost reply passes through", async () => {
    expect(READ_ONLY_MESSAGES.has("wallet.qsbVaults")).toBe(true);
    expect(READ_ONLY_MESSAGES.has("wallet.quoteQsbDeposit")).toBe(true);
    const wallet = createSidepanelRuntime(lost);
    expect(await rejection(() => wallet.loadQsbVaults("qsb-2"))).not.toBeInstanceOf(
      SubmissionUnknownError,
    );
    expect(await rejection(() => wallet.quoteQsbDeposit("qsb-2", 0, 1))).not.toBeInstanceOf(
      SubmissionUnknownError,
    );
  });

  test("create, deposit and resend are writes: a lost reply is outcome-unknown", async () => {
    for (const type of [
      "wallet.createQsbVault",
      "wallet.depositQsbVault",
      "wallet.resendQsbDeposit",
    ]) {
      expect(READ_ONLY_MESSAGES.has(type)).toBe(false);
    }
    const wallet = createSidepanelRuntime(lost);
    expect(await rejection(() => wallet.createQsbVault("qsb-2"))).toBeInstanceOf(
      SubmissionUnknownError,
    );
    expect(await rejection(() => wallet.depositQsbVault("qsb-2", 0, 1, 1))).toBeInstanceOf(
      SubmissionUnknownError,
    );
    expect(await rejection(() => wallet.resendQsbDeposit("qsb-2", 0))).toBeInstanceOf(
      SubmissionUnknownError,
    );
  });
});
