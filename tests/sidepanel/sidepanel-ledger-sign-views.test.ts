/**
 * Snapshot-style coverage for the pure Ledger sign device-prompt template. Each
 * phase (connect / confirm / error) renders its title, controls, and the
 * account/index being signed with, and the error phase surfaces the catalog
 * message escaped — never a raw device error as the headline.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerSignRequestSummary, WalletStatus } from "../../src/popup/responses";
import type { LedgerSignView } from "../../src/sidepanel/ledger/sign-session";
import { ledgerSignScreen } from "../../src/sidepanel/ledger/sign-views";
import { ledgerAccountPath } from "../../src/starknet/ledger-path";

const request: LedgerSignRequestSummary = {
  accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
  id: "ledger-sign-1",
  messageHash: "0xabc",
  path: ledgerAccountPath(3),
  publicKeyX: "0xabc",
};

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const render = (phase: LedgerSignView["phase"]): string =>
  ledgerSignScreen({ phase, request }, status);

describe("ledgerSignScreen", () => {
  test("connect phase offers the connect gesture and names the signer index", () => {
    const html = render({ kind: "connect" });
    expect(html).toContain("Connect your Ledger");
    expect(html).toContain("data-ledger-connect");
    // The account index is recovered from the stored path for the signer line.
    expect(html).toContain("Account 3");
    expect(html).toContain("Starknet Mainnet");
  });

  test("confirming phase shows the on-device wait and a cancel control", () => {
    const html = render({ kind: "confirming" });
    expect(html).toContain("Confirm on your Ledger");
    expect(html).toContain("data-ledger-cancel");
    expect(html).not.toContain("data-ledger-connect");
  });

  test("error phase renders the escaped catalog message with retry and cancel", () => {
    const html = render({
      code: "blind-signing-disabled",
      kind: "error",
      message: "Turn on Blind signing in the Starknet app settings on your Ledger, then retry.",
    });
    expect(html).toContain("Ledger could not sign");
    expect(html).toContain("Turn on Blind signing");
    expect(html).toContain("data-ledger-retry");
    expect(html).toContain("data-ledger-cancel");
  });

  test("device phase renders escaped device choices", () => {
    const html = render({
      devices: [
        { id: "first", label: "Ledger Nano X 1" },
        { id: "second", label: "Ledger <2>" },
      ],
      kind: "devices",
    });
    expect(html).toContain("Choose your Ledger");
    expect(html).toContain('data-ledger-device="second"');
    expect(html).toContain("Ledger &lt;2&gt;");
  });

  test("a path with no recoverable index omits the index suffix", () => {
    const html = ledgerSignScreen(
      { phase: { kind: "confirming" }, request: { ...request, path: "m/not-a-path" } },
      status,
    );
    expect(html).not.toContain("Account ");
  });
});
