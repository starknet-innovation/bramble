/**
 * Pure Ledger-onboarding template coverage: the add-account chooser,
 * connect/reading/error device states, multi-device choice, and the account
 * picker with deployed status, balance, duplicate handling, and selected count.
 */
import { describe, expect, test } from "bun:test";
import type { LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import type { LedgerCandidate } from "../../../../src/sidepanel/journeys/ledger/onboard-session";
import {
  addAccountChooser,
  importAccountChooser,
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerDevicePicker,
  ledgerOnboardError,
  ledgerReadingPrompt,
} from "../../../../src/sidepanel/journeys/ledger/onboard-views";

const candidateAccount = (
  index: number,
  accountContractType: "argent" | "openzeppelin" = "openzeppelin",
): LedgerAccountRef => ({
  ...(accountContractType === "argent"
    ? ({ accountContractType, deploymentSalt: "0x1" } as const)
    : ({ accountContractType } as const)),
  address: `0x${accountContractType === "argent" ? "e" : ""}${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`,
  classHash: "0x2234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  derivation: {
    accountIndex: index,
    eip2645application: "LedgerW",
    kind: "ledger",
    path: ledgerAccountPath(index),
  },
  id: `SN_MAIN:0x${accountContractType === "argent" ? "e" : ""}${(index + 10).toString(16)}5567890abcdef1234567890abcdef1234567890abcdef1234567890ab`,
  networkId: "SN_MAIN",
  publicKeyX: `0x${index + 1}`,
});

describe("onboarding views", () => {
  test("the chooser offers exactly the four ways to make an account", () => {
    const html = addAccountChooser();
    expect(html).toContain('data-add-kind="regular"');
    expect(html).toContain('data-add-kind="ledger"');
    expect(html).toContain('data-add-kind="multisig"');
    expect(html).toContain('data-add-kind="import"');
    expect(html).toContain("Regular account");
    expect(html).toContain("Ledger account");
    expect(html).toContain("Multisig account");
    // Bringing over a Ready Ledger account is importing one you already own,
    // so it sits with the other imports rather than beside the create routes.
    expect(html).not.toContain('data-add-kind="restore-ready-ledger"');
    expect(html).toContain("Import an existing account");
    // Contract choice is gone: every creation route is the Bramble account.
    expect(html).not.toContain("argent ");
    expect(html).not.toContain("openzeppelin");
    expect((html.match(/data-add-kind="/g) ?? []).length).toBe(4);
    expect(html.indexOf('data-add-kind="regular"')).toBeLessThan(
      html.indexOf('data-add-kind="import"'),
    );
    // Tiles route on their own click: no confirm step and no selection state.
    expect(html).not.toContain("data-add-continue");
    expect(html).not.toContain("aria-pressed");
  });

  test("importing an existing account offers the phrase, a key, and a Ready Ledger", () => {
    const html = importAccountChooser();

    expect(html).toContain('data-add-kind="import-phrase"');
    expect(html).toContain('data-add-kind="import-key"');
    expect(html).toContain('data-add-kind="restore-ready-ledger"');
    expect(html).toContain("Ready’s derivation path");
    expect((html.match(/data-add-kind="/g) ?? []).length).toBe(3);
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
    }
    // The single-click chooser carries no action row; the device states do.
    for (const html of [ledgerConnectPrompt(), ledgerReadingPrompt(), ledgerOnboardError("n")]) {
      expect(html).toContain("onboard-actions");
    }
    expect(ledgerAccountPicker([])).toContain('class="onboard-picker"');
  });

  test("the picker groups candidates by contract family with detected counts", () => {
    const candidates: LedgerCandidate[] = [
      {
        account: candidateAccount(0),
        balance: "1.5 STRK",
        deployed: true,
        duplicate: false,
        funded: true,
      },
      {
        account: candidateAccount(0, "argent"),
        balance: "0 STRK",
        deployed: false,
        duplicate: false,
        funded: false,
      },
    ];
    const html = ledgerAccountPicker(candidates, [candidateAccount(0).id]);
    expect(html).toContain('data-account-group="openzeppelin"');
    expect(html).toContain('data-account-group="argent"');
    expect(html).toContain("Bramble accounts");
    // Argent-model accounts at Bramble's own path are not Ready accounts: Ready
    // reads the device at a different path, served by the restore route.
    expect(html).toContain("Argent accounts");
    expect(html).not.toContain("Ready accounts");
    expect(html).toContain("Select accounts");
    // Only the active Bramble candidate counts as detected.
    expect(html).toContain("1 found");
    expect(html).toContain("Account 0");
    expect(html).toContain("Deployed");
    expect(html).toContain("1.5 STRK");
    expect(html).toContain(`data-ledger-toggle="${candidateAccount(0).id}"`);
    // The idle Ready candidate is listed but not selectable.
    expect(html).toMatch(
      new RegExp(`data-ledger-toggle="${candidateAccount(0, "argent").id}"[^>]*disabled`),
    );
    expect(html).toContain("Add selected (1)");
    expect(html).toContain("data-ledger-load-more");
    expect(html).toContain("data-ledger-add-selected");
  });

  test("the Ready restore picker is one flat list of Ready accounts with paging guidance", () => {
    const ready = (index: number): LedgerAccountRef => ({
      ...candidateAccount(index, "argent"),
      derivation: {
        accountIndex: index,
        eip2645application: "argentx",
        kind: "ledger",
        path: ledgerAccountPath(index, "argentx"),
      },
    });
    const candidates: LedgerCandidate[] = [
      { account: ready(12), balance: "3 STRK", deployed: true, duplicate: false, funded: true },
      { account: ready(13), balance: "0 STRK", deployed: false, duplicate: false, funded: false },
    ];
    const html = ledgerAccountPicker(candidates, [ready(12).id], undefined, "argentx");
    expect(html).toContain("Select Ready accounts");
    expect(html).toContain("Ready accounts");
    expect(html).toContain("Ready’s derivation path");
    // Ready numbers Ledger accounts after the wallet's other accounts.
    expect(html).toContain("Show more");
    expect(html).toContain("a few pages in");
    // A flat list, not a disclosure group the runtime toggles.
    expect(html).toContain("data-ready-accounts");
    expect(html).not.toContain("data-account-group");
    expect(html).not.toContain("Bramble accounts");
    expect(html).not.toContain("<details");
    expect(html).toContain("1 found");
    expect(html).toContain("Account 12");
    expect(html).toContain(`data-ledger-toggle="${ready(12).id}"`);
    // An idle Ready index is listed but not selectable, as on the Ledger route.
    expect(html).toMatch(new RegExp(`data-ledger-toggle="${ready(13).id}"[^>]*disabled`));
    expect(html).toContain("Add selected (1)");
    expect(ledgerAccountPicker([], [], undefined, "argentx")).toContain("No accounts read");
  });

  test('"Add selected" is disabled until at least one index is picked', () => {
    const html = ledgerAccountPicker(
      [
        {
          account: candidateAccount(0),
          balance: null,
          deployed: null,
          duplicate: false,
          funded: null,
        },
      ],
      [],
    );
    expect(html).toContain("data-ledger-add-selected");
    expect(/data-ledger-add-selected[^>]*disabled/.test(html)).toBe(true);
  });

  test("an undeployed candidate reflects needs-funding, distinct from an error", () => {
    const html = ledgerAccountPicker([
      {
        account: candidateAccount(1),
        balance: null,
        deployed: false,
        duplicate: false,
        funded: false,
      },
    ]);
    expect(html).toContain("needs funding");
    expect(html).toContain("balance unavailable");
  });

  test("a checking candidate and a duplicate render distinctly", () => {
    const checking = ledgerAccountPicker([
      {
        account: candidateAccount(2),
        balance: null,
        deployed: null,
        duplicate: false,
        funded: null,
      },
    ]);
    expect(checking).toContain("Checking…");

    const duplicate = ledgerAccountPicker([
      {
        account: candidateAccount(3),
        balance: "0 STRK",
        deployed: true,
        duplicate: true,
        funded: false,
      },
    ]);
    expect(duplicate).toContain("Already in this wallet");
    expect(duplicate).not.toContain("data-ledger-toggle");
  });

  test("an empty candidate list renders the empty state", () => {
    expect(ledgerAccountPicker([])).toContain("No accounts read");
  });
});
