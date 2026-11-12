/**
 * The Ledger journey (add/import choosers, connect, reading, device choice,
 * surface notices, error and the account picker) renders in Simplified Chinese
 * when that is the UI language: its catalog sentences appear, facts stay
 * intact, and no English Ledger sentence leaks into the markup.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { escapeHtml } from "@bramble/core/html";
import type { LedgerAccountRef } from "@bramble/wallet-model/accounts";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";
import { setUiLocale } from "../../src/i18n/locale";
import { uiCatalogs } from "../../src/i18n/messages";
import type { LedgerCandidate } from "../../src/sidepanel/journeys/ledger/onboard-session";
import {
  addAccountChooser,
  importAccountChooser,
  ledgerAccountPicker,
  ledgerConnectPrompt,
  ledgerDevicePicker,
  ledgerOnboardError,
  ledgerReadingPrompt,
  ledgerSurfaceNotice,
  ledgerSurfaceSwitched,
} from "../../src/sidepanel/journeys/ledger/onboard-views";

afterEach(() => setUiLocale("en"));

const account = (index: number): LedgerAccountRef => ({
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

const candidates: LedgerCandidate[] = [
  { account: account(0), balance: "1.5 STRK", deployed: true, duplicate: false, funded: true },
  { account: account(1), balance: "0 STRK", deployed: false, duplicate: false, funded: false },
  { account: account(2), balance: "0 STRK", deployed: null, duplicate: false, funded: null },
];

const englishSentences = Object.entries(uiCatalogs.en)
  .filter(([key, text]) => key.startsWith("ledger.") && !text.includes("{"))
  .map(([, text]) => text)
  .filter((text) => text.length > 6);

const leaks = (html: string): readonly string[] =>
  englishSentences.filter((text) => html.includes(text) || html.includes(escapeHtml(text)));

const screens = (): Readonly<Record<string, string>> => ({
  add: addAccountChooser(),
  connect: ledgerConnectPrompt(),
  devices: ledgerDevicePicker([{ id: "d1", label: "Nano X" }] as never),
  error: ledgerOnboardError("Device locked."),
  import: importAccountChooser(),
  picker: ledgerAccountPicker(candidates, [account(0).id]),
  reading: ledgerReadingPrompt(),
  surface: ledgerSurfaceNotice(),
  switched: ledgerSurfaceSwitched(),
});

describe("Ledger journey in Simplified Chinese", () => {
  test("no English Ledger sentence leaks into any screen", () => {
    setUiLocale("zh-Hans");
    for (const [name, html] of Object.entries(screens())) {
      expect(leaks(html), name).toEqual([]);
    }
  });

  test("the leak check catches the English rendering", () => {
    expect(leaks(screens()["connect"] ?? "").length).toBeGreaterThan(0);
  });

  test("screens carry their Chinese copy and keep facts verbatim", () => {
    setUiLocale("zh-Hans");
    const all = screens();
    expect(all["add"]).toContain("添加新账户");
    expect(all["connect"]).toContain("连接 Ledger");
    expect(all["devices"]).toContain("Nano X");
    const picker = all["picker"] ?? "";
    expect(picker).toContain("选择账户");
    expect(picker).toContain("账户 0");
    expect(picker).toContain("已部署在 Starknet");
    expect(picker).toContain("Bramble 账户");
    expect(picker).toContain("添加所选（1）");
    expect(picker).toContain("正在检查…");
  });

  test("English output is unchanged", () => {
    const picker = ledgerAccountPicker(candidates, [account(0).id]);
    expect(picker).toContain("Bramble accounts");
    expect(picker).toContain("Account 0");
    expect(picker).toContain("Add selected (1)");
    expect(addAccountChooser()).toContain(
      "Create the next account from this wallet’s recovery phrase.",
    );
  });
});
