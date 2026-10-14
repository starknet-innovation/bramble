/**
 * Snapshot-style coverage for the pure Ledger sign device-prompt template. Each
 * Each phase renders its title, controls, progress rail, and the account/index
 * being signed with. Errors surface escaped catalog recovery copy.
 */
import { describe, expect, test } from "bun:test";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
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
    expect(html).toContain("Connect and unlock your Ledger, then open the Starknet app.");
    expect(html).toContain("data-ledger-connect");
    // The account index is recovered from the stored path for the signer line.
    expect(html).toContain("Account 3");
    expect(html).toContain("Starknet Mainnet");
    // The signer line shows the account's address (never the id's network
    // prefix) truncated, with the full address on hover.
    const address = request.accountId.slice(request.accountId.indexOf(":") + 1);
    expect(html).toContain(`<code title="${address}">0x1234…bcde</code>`);
    expect(html).not.toContain("SN_MAI…");
  });

  test("confirming phase shows the on-device wait and a cancel control", () => {
    const html = render({ kind: "confirming" });
    expect(html).toContain("Approve on your Ledger");
    expect(html).toContain("data-ledger-cancel");
    expect(html).not.toContain("data-ledger-connect");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('data-liquid-dots="ledger"');
    expect(html).toContain('id="bramble-liquid-dots-ledger"');
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

  // Errors audit F9: once the device has signed, "not signed or broadcast" is
  // false, so a wallet-side failure after the signature does not say it.
  test("a failure after the signature does not claim nothing was signed", () => {
    const html = render({
      code: null,
      kind: "error",
      message: "Signing on your Ledger didn't finish. Check Activity before trying again.",
    });
    expect(html).toContain("Signing on your Ledger didn&#39;t finish");
    expect(html).not.toContain("The transaction has not been signed or broadcast.");
    const device = render({ code: "rejected-on-device", kind: "error", message: "x" });
    expect(device).toContain("The transaction has not been signed or broadcast.");
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

  // Copy review #385: the title and liveness line carry checking and
  // submitting, so their body sentences were deleted.
  test("verification and handoff phases describe the real work in progress", () => {
    expect(render({ kind: "checking" })).toContain("Checking the Starknet app");
    expect(render({ kind: "checking" })).not.toContain("Reading the Starknet app version");
    expect(render({ kind: "verifying" })).toContain("Checking this is the right Ledger.");
    expect(render({ kind: "confirming" })).toContain("Approve the request on your Ledger.");
    expect(render({ kind: "submitting" })).toContain("Finishing securely");
    expect(render({ kind: "submitting" })).not.toContain("Bramble is completing its final");
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
      // Grouped in fours for character-by-character comparison; reading only
      // those exact groups must recover the padded hash the device receives.
      const value = html.split('<p class="ledger-hash-value">')[1]?.split("</p>")[0] ?? "";
      const rendered = `0x${Array.from(value.matchAll(/<span>([0-9a-f]{4})<\/span>/g), (match) => match[1]).join("")}`;
      expect(rendered).toBe(padded);
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
    const rendered = `0x${Array.from(value.matchAll(/<span>([0-9a-f]{4})<\/span>/g), (match) => match[1]).join("")}`;
    expect(rendered).toBe(`0x${"abc".padStart(64, "0")}`);
  });
});
