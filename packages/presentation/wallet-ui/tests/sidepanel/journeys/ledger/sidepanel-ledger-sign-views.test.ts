/**
 * Snapshot-style coverage for the pure Ledger sign device-prompt template. Each
 * Each phase renders its title, controls, progress rail, and the account/index
 * being signed with. Errors surface escaped catalog recovery copy.
 */
import { describe, expect, test } from "bun:test";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import type {
  LedgerSignRequestSummary,
  WalletStatus,
} from "../../../../src/popup/responses/responses";
import type { LedgerSignView } from "../../../../src/sidepanel/journeys/ledger/sign-session";
import { ledgerSignScreen } from "../../../../src/sidepanel/journeys/ledger/sign-views";

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
    expect(html).toContain("Approve on your Ledger");
    expect(html).toContain("data-ledger-cancel");
    expect(html).not.toContain("data-ledger-connect");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('data-liquid-dots="ledger"');
    expect(html).toContain('id="mc-liquid-dots-ledger"');
  });

  test("error phase renders the escaped catalog message with retry and cancel", () => {
    const html = render({
      code: "blind-signing-disabled",
      kind: "error",
      message: "Turn on Blind signing in the Starknet app settings on your Ledger, then retry.",
    });
    expect(html).toContain("Ledger needs attention");
    expect(html).toContain("Turn on Blind signing");
    expect(html).toContain("data-ledger-retry");
    expect(html).toContain("data-ledger-cancel");
    expect(html).not.toContain('data-liquid-dots="ledger"');
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

  test("verification and handoff phases describe the real work in progress", () => {
    expect(render({ kind: "checking" })).toContain("Reading the Starknet app version");
    expect(render({ kind: "verifying" })).toContain("Matching the device public key");
    expect(render({ kind: "submitting" })).toContain("Signature received");
  });

  test("a path with no recoverable index omits the index suffix", () => {
    const html = ledgerSignScreen(
      { phase: { kind: "confirming" }, request: { ...request, path: "m/not-a-path" } },
      status,
    );
    expect(html).not.toContain("Account ");
  });

  test("every phase shows the signing hash at the padded width the device displays", () => {
    // A realistic full-width hash, not a short stub: the panel must render the
    // same 64 digits the device is handed, so a narrower rendering would ask the
    // user to compare two different spellings of one number.
    // 63 digits — the widest a felt can be under the field prime — so padding to
    // the device's 64 adds exactly one leading zero.
    const messageHash = `0x${"3f".repeat(31)}a`;
    const padded = `0x0${messageHash.slice(2)}`;
    for (const phase of [
      { kind: "connect" },
      { kind: "confirming" },
      { kind: "verifying" },
      { kind: "submitting" },
    ] as const) {
      const html = ledgerSignScreen({ phase, request: { ...request, messageHash } }, status);
      expect(html).toContain("Hash shown on your Ledger");
      // Copy hands over the unbroken padded value, never the grouped rendering.
      expect(html).toContain(`data-copy="${padded}"`);
      // Grouped in fours for character-by-character comparison; stripping the
      // markup must recover exactly the padded hash the device receives.
      const value = html.split('<p class="ledger-hash-value">')[1]?.split("</p>")[0] ?? "";
      expect(value.replace(/<[^>]*>/g, "")).toBe(padded);
      // 64 digits in groups of four.
      expect(value.match(/<span>[0-9a-f]{4}<\/span>/g)).toHaveLength(16);
    }
  });

  test("a short hash is padded rather than shown at its narrow width", () => {
    const html = ledgerSignScreen(
      { phase: { kind: "confirming" }, request: { ...request, messageHash: "0xabc" } },
      status,
    );
    const value = html.split('<p class="ledger-hash-value">')[1]?.split("</p>")[0] ?? "";
    expect(value.replace(/<[^>]*>/g, "")).toBe(`0x${"abc".padStart(64, "0")}`);
  });
});
