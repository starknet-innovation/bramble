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
  intent: "send-token",
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

  test("discloses the padded hash in every phase so the device can be compared", () => {
    // The device signs a fixed-width 32-byte value, so the screen shows the
    // padded form; a shortest-form felt would differ from the device by its
    // dropped leading zeros and defeat the comparison.
    const padded = `0x${"0".repeat(61)}abc`;
    const phases: readonly LedgerSignView["phase"][] = [
      { kind: "connect" },
      { kind: "confirming" },
      { kind: "submitting" },
      { code: "device-locked", kind: "error", message: "Unlock your Ledger." },
    ];
    for (const phase of phases) {
      const html = render(phase);
      expect(html).toContain("Hash being signed");
      expect(html).toContain(padded);
      expect(html).not.toContain(">0xabc<");
    }
  });

  test("states what the signature authorizes in every phase", () => {
    // Under blind signing the device shows only a bare hash, so this line is the
    // sole description of the operation the user gets. It must be present
    // wherever the prompt is, including the error phase they may retry from.
    const phases: readonly LedgerSignView["phase"][] = [
      { kind: "connect" },
      { kind: "confirming" },
      { kind: "submitting" },
      { code: "device-locked", kind: "error", message: "Unlock your Ledger." },
    ];
    for (const phase of phases) {
      expect(render(phase)).toContain("Sign to send");
    }
  });

  test("each intent renders its own copy rather than a shared generic label", () => {
    const copyFor = (intent: LedgerSignRequestSummary["intent"]): string =>
      ledgerSignScreen({ phase: { kind: "confirming" }, request: { ...request, intent } }, status);
    expect(copyFor("dapp-message")).toContain("Sign a message from this site");
    expect(copyFor("multisig-revoke")).toContain("Sign to revoke your confirmation");
    expect(copyFor("revoke-spending")).toContain("Sign to revoke a spending approval");
    expect(copyFor("strk20-register-authorize")).toContain(
      "Sign to authorize joining the privacy pool",
    );
    // Each half of a two-signature operation authorizes something different, so
    // no pair may share one label — that is indistinguishable from the wallet
    // asking twice for the same approval.
    for (const [first, second] of [
      ["strk20-authorize", "strk20-broadcast"],
      ["strk20-register-authorize", "strk20-register-broadcast"],
      ["strk20-shield-authorize", "strk20-shield-broadcast"],
      ["strk20-transfer-authorize", "strk20-transfer-relay"],
    ] as const) {
      expect(copyFor(first)).not.toBe(copyFor(second));
      expect(copyFor(first)).toContain("Signature 1 of 2");
      expect(copyFor(second)).toContain("Signature 2 of 2");
    }
    // A relayed transfer broadcasts nothing from this account, so its second
    // prompt must not claim otherwise.
    expect(copyFor("strk20-transfer-relay")).not.toContain("broadcast");
  });

  test("a single-signature operation states no step count", () => {
    const html = ledgerSignScreen(
      { phase: { kind: "confirming" }, request: { ...request, intent: "strk20-viewing-key" } },
      status,
    );

    expect(html).toContain("Sign to derive your viewing key");
    // "Signature 1 of 1" would invent a sequence the user is not in.
    expect(html).not.toContain("Signature");
  });

  test("a path with no recoverable index omits the index suffix", () => {
    const html = ledgerSignScreen(
      { phase: { kind: "confirming" }, request: { ...request, path: "m/not-a-path" } },
      status,
    );
    expect(html).not.toContain("Account ");
  });
});
