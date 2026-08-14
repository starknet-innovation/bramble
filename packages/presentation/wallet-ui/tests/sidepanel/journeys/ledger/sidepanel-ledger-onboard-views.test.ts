/**
 * Pure Ledger-onboarding template coverage: the add-account chooser,
 * connect/reading/error device states, multi-device choice, and the account
 * picker with deployed status, balance, duplicate handling, and selected count.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerAccountRef } from "@mc-wallet/wallet-model/accounts";
import { ledgerAccountPath } from "@mc-wallet/wallet-model/ledger-path";
import type { LedgerCandidate } from "../../../../src/sidepanel/journeys/ledger/onboard-types";
import {
  addAccountChooser,
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerDevicePicker,
  ledgerOnboardError,
  ledgerReadingPrompt,
} from "../../../../src/sidepanel/journeys/ledger/onboard-views";

const candidateAccount = (index: number): LedgerAccountRef => ({
  accountContractType: "openzeppelin",
  address: `0x${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: {
    accountIndex: index,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(index),
  },
  id: `SN_MAIN:0x${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`,
  networkId: "SN_MAIN",
  publicKeyX: `0x${index + 1}`,
});

describe("onboarding views", () => {
  test("the chooser offers both account contracts for software and Ledger signers", () => {
    const html = addAccountChooser();
    expect(html).toContain('data-add-kind="argent"');
    expect(html).toContain('data-add-kind="openzeppelin"');
    expect(html).toContain('data-add-kind="import"');
    expect(html).toContain('data-add-kind="ledger-argent"');
    expect(html).toContain('data-add-kind="ledger-openzeppelin"');
    expect(html).toContain('data-add-kind="multisig"');
    expect(html).toContain("Argent Account");
    expect(html).toContain("OpenZeppelin Account");
    expect(html).toContain("Argent Ledger Account");
    expect(html).toContain("OpenZeppelin Ledger Account");
    expect(html).toContain("Import from private key");
    expect(html).toContain("Argent Multisig");
    expect(html).toMatch(/data-add-continue[^>]*disabled/);
    expect(addAccountChooser("argent")).toMatch(/data-add-kind="argent"[^>]*aria-pressed="true"/);
  });

  test("connect, reading, and error device states render their controls", () => {
    expect(ledgerConnectPrompt()).toContain("data-ledger-onboard-connect");
    expect(ledgerReadingPrompt()).toContain("Reading accounts");
    expect(ledgerOnboardError("Unlock your Ledger, then try again.")).toContain(
      "Unlock your Ledger",
    );
  });

  test("the multi-device picker exposes opaque escaped choices", () => {
    const html = ledgerDevicePicker([
      { id: "ledger-device-1", label: "Ledger Nano X 1" },
      { id: "ledger-device-2", label: "Ledger <2>" },
    ]);
    expect(html).toContain('data-ledger-device="ledger-device-2"');
    expect(html).toContain("Ledger &lt;2&gt;");
  });

  test("the chooser and short states share the centred overlay shell", () => {
    for (const html of [
      addAccountChooser(),
      ledgerConnectPrompt(),
      ledgerReadingPrompt(),
      ledgerOnboardError("nope"),
    ]) {
      expect(html).toContain('class="onboard-hero');
      expect(html).toContain("onboard-actions");
    }
    expect(ledgerAccountPicker([])).toContain('class="onboard-picker"');
  });

  test("the picker shows address, deployed status, balance, and a selectable row", () => {
    const candidates: LedgerCandidate[] = [
      { account: candidateAccount(0), balance: "1.5 STRK", deployed: true, duplicate: false },
    ];
    const html = ledgerAccountPicker(candidates, [0]);
    expect(html).toContain("Account 0");
    expect(html).toContain("Deployed");
    expect(html).toContain("1.5 STRK");
    expect(html).toContain('data-ledger-toggle="0"');
    expect(html).toContain("Add selected (1)");
    expect(html).toContain("data-ledger-load-more");
    expect(html).toContain("data-ledger-add-selected");
  });

  test('"Add selected" is disabled until at least one index is picked', () => {
    const html = ledgerAccountPicker(
      [{ account: candidateAccount(0), balance: null, deployed: null, duplicate: false }],
      [],
    );
    expect(html).toContain("data-ledger-add-selected");
    expect(/data-ledger-add-selected[^>]*disabled/.test(html)).toBe(true);
  });

  test("an undeployed candidate reflects needs-funding, distinct from an error", () => {
    const html = ledgerAccountPicker([
      { account: candidateAccount(1), balance: null, deployed: false, duplicate: false },
    ]);
    expect(html).toContain("needs funding");
    expect(html).toContain("balance unavailable");
  });

  test("a checking candidate and a duplicate render distinctly", () => {
    const checking = ledgerAccountPicker([
      { account: candidateAccount(2), balance: null, deployed: null, duplicate: false },
    ]);
    expect(checking).toContain("Checking…");

    const duplicate = ledgerAccountPicker([
      { account: candidateAccount(3), balance: "0 STRK", deployed: true, duplicate: true },
    ]);
    expect(duplicate).toContain("Already in this wallet");
    expect(duplicate).not.toContain("data-ledger-toggle");
  });

  test("an empty candidate list renders the empty state", () => {
    expect(ledgerAccountPicker([])).toContain("No accounts read");
  });
});
