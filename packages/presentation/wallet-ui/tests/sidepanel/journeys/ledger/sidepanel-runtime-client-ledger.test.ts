/**
 * Side-panel runtime message client (Ledger wrappers): the account-picker
 * derivation, keyless-account creation, and the two halves of the device-sign
 * round-trip. Each asserts the request envelope the wrapper builds and both arms
 * (a guard-valid reply and an unrecognised/error reply). No DOM; the runtime is
 * a plain fake.
 */
import { describe, expect, test } from "bun:test";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import {
  account,
  captureRuntime,
  errorEnvelope,
  runtimeReturning,
} from "../../../support/runtime-client-fixtures";

const ledgerAccount = {
  accountContractType: "openzeppelin" as const,
  address: "0x123",
  classHash: "0xabc",
  derivation: {
    accountIndex: 0,
    eip2645application: "LedgerW" as const,
    kind: "ledger" as const,
    path: ledgerAccountPath(0),
  },
  id: "SN_SEPOLIA:0x123",
  networkId: "SN_SEPOLIA" as const,
  publicKeyX: "0xabc",
};

describe("Ledger runtime wrappers", () => {
  test("addLedgerAccount sends index/network/pubkey and returns the id", async () => {
    const { sent, wallet } = captureRuntime({ account, ok: true });
    expect(await wallet.addLedgerAccount("SN_MAIN", 2, "0xabc", "openzeppelin")).toBe(account.id);
    expect(sent[0]).toEqual({
      accountContractType: "openzeppelin",
      accountIndex: 2,
      networkId: "SN_MAIN",
      publicKeyX: "0xabc",
      type: "wallet.addLedgerAccount",
    });
  });

  test("a named path scheme rides along in every Ledger envelope, and only then", async () => {
    const { sent, wallet } = captureRuntime({ account, ok: true });
    await wallet.addLedgerAccount("SN_MAIN", 12, "0xabc", "argent", "argentx");
    expect(sent[0]).toEqual({
      accountContractType: "argent",
      accountIndex: 12,
      eip2645application: "argentx",
      networkId: "SN_MAIN",
      publicKeyX: "0xabc",
      type: "wallet.addLedgerAccount",
    });
    await wallet.createLedgerVault("SN_MAIN", 12, "0xabc", "pass", "argent", "argentx");
    expect(sent[1]).toMatchObject({
      eip2645application: "argentx",
      type: "wallet.createLedgerVault",
    });
    const entries = [{ accountIndex: 12, publicKeyX: "0xabc" }];
    const derive = captureRuntime({ accounts: [], ok: true });
    await derive.wallet.deriveLedgerAccounts("SN_MAIN", entries, "argent", "argentx");
    expect(derive.sent[0]).toEqual({
      accountContractType: "argent",
      eip2645application: "argentx",
      entries,
      networkId: "SN_MAIN",
      type: "wallet.deriveLedgerAccounts",
    });
    // Bramble's own scheme is still sent explicitly when the caller names it.
    await derive.wallet.deriveLedgerAccounts("SN_MAIN", entries, "openzeppelin", "LedgerW");
    expect(derive.sent[1]).toMatchObject({ eip2645application: "LedgerW" });
  });

  test("addLedgerAccount throws its fallback on an unrecognised reply", async () => {
    await expect(
      runtimeReturning({ ok: true }).addLedgerAccount("SN_MAIN", 0, "0xabc", "openzeppelin"),
    ).rejects.toThrow("add Ledger account failed");
  });

  test("createLedgerVault sends index/network/pubkey/passphrase and returns the id", async () => {
    const { sent, wallet } = captureRuntime({ account, ok: true });
    expect(
      await wallet.createLedgerVault(
        "SN_MAIN",
        0,
        "0xabc",
        "correct horse battery",
        "openzeppelin",
      ),
    ).toBe(account.id);
    expect(sent[0]).toEqual({
      accountContractType: "openzeppelin",
      accountIndex: 0,
      networkId: "SN_MAIN",
      publicKeyX: "0xabc",
      type: "wallet.createLedgerVault",
      vaultPassphrase: "correct horse battery",
    });
  });

  test("createLedgerVault throws its fallback on an unrecognised reply", async () => {
    await expect(
      runtimeReturning({ ok: true }).createLedgerVault(
        "SN_MAIN",
        0,
        "0xabc",
        "pass",
        "openzeppelin",
      ),
    ).rejects.toThrow("create Ledger wallet failed");
  });

  test("ledgerAccountStatus returns the resolved on-chain state", async () => {
    const { sent, wallet } = captureRuntime({
      balance: "1.5 STRK",
      deployed: true,
      funded: true,
      ok: true,
    });
    expect(await wallet.ledgerAccountStatus("0x123", "SN_MAIN")).toEqual({
      balance: "1.5 STRK",
      deployed: true,
      funded: true,
    });
    expect(sent[0]).toEqual({
      address: "0x123",
      networkId: "SN_MAIN",
      type: "wallet.ledgerAccountStatus",
    });
  });

  test("ledgerAccountStatus degrades to unavailable on an unrecognised reply", async () => {
    expect(await runtimeReturning({ ok: false }).ledgerAccountStatus("0x123", "SN_MAIN")).toEqual({
      balance: null,
      deployed: null,
      funded: null,
    });
  });

  test("deriveLedgerAccounts sends entries and returns the derived list", async () => {
    const entries = [{ accountIndex: 0, publicKeyX: "0xabc" }];
    const { sent, wallet } = captureRuntime({ accounts: [ledgerAccount], ok: true });
    expect(await wallet.deriveLedgerAccounts("SN_SEPOLIA", entries, "openzeppelin")).toEqual([
      ledgerAccount,
    ]);
    expect(sent[0]).toEqual({
      accountContractType: "openzeppelin",
      entries,
      networkId: "SN_SEPOLIA",
      type: "wallet.deriveLedgerAccounts",
    });
  });

  test("deriveLedgerAccounts throws on an error envelope", async () => {
    await expect(
      runtimeReturning(errorEnvelope).deriveLedgerAccounts("SN_MAIN", [], "openzeppelin"),
    ).rejects.toThrow("boom");
  });

  test("loadLedgerSignPending returns the parked list, empty on a bad reply", async () => {
    const pending = [
      {
        accountId: "SN_SEPOLIA:0x123",
        id: "ledger-sign-1",
        messageHash: "0x1",
        path: ledgerAccountPath(0),
        publicKeyX: "0xabc",
      },
    ];
    const { sent, wallet } = captureRuntime({ ok: true, pending });
    expect(await wallet.loadLedgerSignPending()).toEqual(pending);
    expect(sent[0]).toEqual({ type: "wallet.ledgerSignPending" });
    expect(await runtimeReturning({ ok: false }).loadLedgerSignPending()).toEqual([]);
  });

  test("completeLedgerSign forwards a signature outcome and resolves on ok", async () => {
    const { sent, wallet } = captureRuntime({ ok: true });
    await wallet.completeLedgerSign({ id: "ledger-sign-1", r: "0x1", s: "0x2" });
    expect(sent[0]).toEqual({
      id: "ledger-sign-1",
      r: "0x1",
      s: "0x2",
      type: "wallet.completeLedgerSign",
    });
  });

  test("completeLedgerSign forwards a rejection outcome", async () => {
    const { sent, wallet } = captureRuntime({ ok: true });
    await wallet.completeLedgerSign({ error: "rejected-on-device", id: "ledger-sign-1" });
    expect(sent[0]).toEqual({
      error: "rejected-on-device",
      id: "ledger-sign-1",
      type: "wallet.completeLedgerSign",
    });
  });

  test("completeLedgerSign throws its fallback when the reply is not ok", async () => {
    await expect(
      runtimeReturning(errorEnvelope).completeLedgerSign({ id: "x", r: "0x1", s: "0x2" }),
    ).rejects.toThrow("boom");
  });
});
