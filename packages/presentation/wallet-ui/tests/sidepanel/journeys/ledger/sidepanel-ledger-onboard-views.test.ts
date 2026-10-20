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

  test("importing an existing account offers a rescan, the phrase, a key, and a Ready Ledger", () => {
    const html = importAccountChooser();

    // The wallet's own accounts: one scan of the phrase it already holds, which
    // is the only route here that imports without asking the reader to type one.
    expect(html).toContain('data-add-kind="find-accounts"');
    expect(html).toContain('data-add-kind="import-phrase"');
    expect(html).toContain('data-add-kind="import-key"');
    expect(html).toContain('data-add-kind="restore-ready-ledger"');
    // The option names the wallet the account came from; where on the device
    // it is read from is the wallet's business, not the reader's.
    expect(html).toContain("Ready (Argent X)");
    expect(html).not.toContain("derivation path");
    expect((html.match(/data-add-kind="/g) ?? []).length).toBe(4);
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
    // Row status in the recovery-phrase picker's words, without a balance.
    expect(html).toContain("Deployed on Starknet");
    expect(html).not.toContain("1.5 STRK");
    expect(html).toContain(
      "No on-chain activity found — Bramble only imports existing Argent accounts",
    );
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
    expect(html).not.toContain("derivation path");
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

  test("an idle Braavos index is listed but not selectable, like an idle Ready one", () => {
    // Importing a Braavos index with no on-chain activity would deploy a new
    // Braavos account, and Bramble only creates Bramble accounts.
    const braavos = (index: number): LedgerAccountRef => {
      const base = candidateAccount(index, "argent");
      return {
        ...base,
        accountContractType: "braavos",
        address: base.address.replace("0xe", "0xb"),
        derivation: {
          accountIndex: index,
          eip2645application: "argentx",
          kind: "ledger",
          path: ledgerAccountPath(index, "argentx"),
        },
        id: base.id.replace(":0xe", ":0xb"),
      };
    };
    const candidates: LedgerCandidate[] = [
      { account: braavos(1), balance: "3 STRK", deployed: true, duplicate: false, funded: true },
      { account: braavos(2), balance: "0 STRK", deployed: false, duplicate: false, funded: false },
    ];
    const html = ledgerAccountPicker(candidates, [], undefined, "argentx");
    expect(html).toMatch(new RegExp(`data-ledger-toggle="${braavos(2).id}"[^>]*disabled`));
    expect(html).not.toMatch(new RegExp(`data-ledger-toggle="${braavos(1).id}"[^>]*disabled`));
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

  test('"Show more" renders busy and disabled while a further page loads', () => {
    const row: LedgerCandidate = {
      account: candidateAccount(0),
      balance: null,
      deployed: null,
      duplicate: false,
      funded: null,
    };
    expect(ledgerAccountPicker([row])).not.toMatch(/data-ledger-load-more[^>]*disabled/);
    expect(ledgerAccountPicker([row], [], undefined, "LedgerW", true)).toMatch(
      /data-ledger-load-more data-busy[^>]*disabled/,
    );
  });

  test("an undeployed candidate says it has no activity, as the recovery picker does", () => {
    const html = ledgerAccountPicker([
      {
        account: candidateAccount(1),
        balance: null,
        deployed: false,
        duplicate: false,
        funded: false,
      },
    ]);
    expect(html).toContain("No on-chain activity found");
    expect(html).not.toContain("balance unavailable");
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
    // As in the recovery picker: the checkbox stays, disabled, beside the status.
    expect(duplicate).toContain("Already in this wallet");
    expect(duplicate).toMatch(
      new RegExp(`data-ledger-toggle="${candidateAccount(3).id}"[^>]*disabled`),
    );
  });

  test("a first-run scan of both paths lists Bramble, Ready and Braavos accounts", () => {
    const at = (
      index: number,
      type: "argent" | "braavos" | "openzeppelin",
      application: "LedgerW" | "argentx",
    ): LedgerAccountRef => {
      const base = candidateAccount(index, type === "braavos" ? "argent" : type);
      const tag = `${application === "argentx" ? "a" : ""}${type === "braavos" ? "b" : ""}`;
      return {
        ...base,
        accountContractType: type,
        address: base.address.replace("0x", `0x${tag}`),
        derivation: {
          accountIndex: index,
          eip2645application: application,
          kind: "ledger",
          path: ledgerAccountPath(index, application),
        },
        id: base.id.replace(":0x", `:0x${tag}`),
      } as LedgerAccountRef;
    };
    const idle = { balance: "0 STRK", deployed: false, duplicate: false, funded: false };
    const live = { balance: "2 STRK", deployed: true, duplicate: false, funded: true };
    const html = ledgerAccountPicker([
      { account: at(0, "openzeppelin", "LedgerW"), ...idle },
      { account: at(0, "argent", "LedgerW"), ...idle },
      { account: at(1, "argent", "LedgerW"), ...live },
      { account: at(0, "argent", "argentx"), ...idle },
      { account: at(0, "braavos", "argentx"), ...idle },
    ]);
    expect(html).toContain("Bramble accounts");
    expect(html).toContain("Ready accounts");
    expect(html).toContain("Braavos accounts");
    expect(html).not.toContain("Argent accounts");
    expect(html).toContain(
      "No on-chain activity found — Bramble only imports existing Braavos accounts",
    );
    expect(html).toContain(
      "No on-chain activity found — Bramble only imports existing Ready accounts",
    );
    // An unused Argent account at Bramble's path would twin every Ready row: it
    // is hidden, while one with activity is listed and named.
    expect(html).not.toContain(`data-ledger-toggle="${at(0, "argent", "LedgerW").id}"`);
    expect(html).toContain(`data-ledger-toggle="${at(1, "argent", "LedgerW").id}"`);
    expect(html).toContain("Account 1 · Bramble path");
    expect(html).toMatch(/Ready accounts<span class="eyebrow" data-detected="1">1 found/);
  });

  test("an empty candidate list renders the empty state", () => {
    expect(ledgerAccountPicker([])).toContain("No accounts read");
  });

  test("omits the Ledger routes when the runtime cannot reach a device", () => {
    const chooser = addAccountChooser(false);
    expect(chooser).not.toContain('data-add-kind="ledger"');
    expect(chooser).not.toContain("Ledger account");
    expect(chooser).toContain('data-add-kind="regular"');
    expect(chooser).toContain('data-add-kind="multisig"');
    expect(chooser).toContain('data-add-kind="import"');
    expect((chooser.match(/data-add-kind="/g) ?? []).length).toBe(3);

    const importChooser = importAccountChooser(false);
    expect(importChooser).not.toContain('data-add-kind="restore-ready-ledger"');
    expect(importChooser).not.toContain("Ready Ledger account");
    expect(importChooser).toContain('data-add-kind="find-accounts"');
    expect(importChooser).toContain('data-add-kind="import-phrase"');
    expect(importChooser).toContain('data-add-kind="import-key"');
    expect((importChooser.match(/data-add-kind="/g) ?? []).length).toBe(3);
  });
});
