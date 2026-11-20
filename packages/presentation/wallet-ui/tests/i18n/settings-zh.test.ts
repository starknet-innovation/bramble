/**
 * The settings screens render in Simplified Chinese when that is the UI
 * language: their own catalog sentences appear, no English sentence from the
 * settings catalog leaks into the markup, and English output is unchanged.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { escapeHtml } from "@bramble/core/html";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { setUiLocale } from "../../src/i18n/locale";
import { uiCatalogs } from "../../src/i18n/messages";
import {
  accountNamesSection,
  hiddenAccountsSection,
} from "../../src/sidepanel/journeys/settings/account-names";
import { groupsSection } from "../../src/sidepanel/journeys/settings/group-members";
import {
  advancedNetworkFlow,
  networkFlow,
} from "../../src/sidepanel/journeys/settings/network-views";
import { privacyUnlockFlow } from "../../src/sidepanel/journeys/settings/privacy-unlock";
import { revealFlow } from "../../src/sidepanel/journeys/settings/reveal-ui";
import {
  appearanceFlow,
  backupExportFlow,
  backupHubFlow,
  backupRestoreFlow,
  requestSettingsFlow,
  settingsScreen,
} from "../../src/sidepanel/journeys/settings/settings-views";
import { emptyStatus } from "../../src/sidepanel/runtime/runtime";

afterEach(() => setUiLocale("en"));

const account = {
  address: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  derivation: { index: 0, kind: "bramble" },
  id: "SN_MAIN:0x1",
  networkId: "SN_MAIN",
} as unknown as AccountRef;
const imported = {
  ...account,
  derivation: { kind: "imported-raw-key" },
  id: "SN_MAIN:0x2",
} as unknown as AccountRef;
const status = {
  ...emptyStatus(),
  accounts: [account, imported],
  activeAccountId: imported.id,
  network: "Mainnet",
  networkId: "SN_MAIN" as const,
};
const preferences = {
  ...defaultWalletPreferences(),
  hiddenAccountIds: [imported.id],
  nftIndexerUrl: "https://indexer.example",
};
const groups = [{ accountIds: [account.id], icon: "folder" as const, id: "work", name: "Work" }];

const screens = (): Readonly<Record<string, string>> => ({
  advanced: advancedNetworkFlow(status, preferences),
  appearance: appearanceFlow(status, preferences),
  backup: backupHubFlow(status),
  backupExport: backupExportFlow(status),
  backupRestore: backupRestoreFlow(status),
  dock: settingsScreen(status, preferences, { branch: "", version: "1.2.3" }),
  folders: groupsSection(groups, [account], preferences, "work", status.networks),
  hidden: hiddenAccountsSection(status, preferences),
  names: accountNamesSection(status, preferences, groups),
  network: networkFlow(status, preferences),
  privacyUnlock: privacyUnlockFlow(status),
  request: requestSettingsFlow(status, preferences),
  reveal: revealFlow(status),
});

// Every multi-word, placeholder-free English settings sentence: single words
// ("Off", "Save") would also match markup and product names.
const englishSentences = Object.entries(uiCatalogs.en)
  .filter(([key, text]) => key.startsWith("settings.") && !text.includes("{"))
  .map(([, text]) => text)
  .filter((text) => text.includes(" "));

const leaks = (html: string): readonly string[] =>
  englishSentences.filter((text) => html.includes(text) || html.includes(escapeHtml(text)));

describe("settings in Simplified Chinese", () => {
  test("every screen renders without an English settings sentence", () => {
    setUiLocale("zh-Hans");
    for (const [name, html] of Object.entries(screens())) {
      expect(leaks(html), name).toEqual([]);
    }
  });

  test("key sentences appear in Chinese, with facts kept verbatim", () => {
    setUiLocale("zh-Hans");
    const all = screens();
    expect(all["dock"]).toContain("<h2>设置</h2>");
    expect(all["dock"]).toContain("版本 1.2.3");
    expect(all["reveal"]).toContain("任何看到这些内容的人都能拿走你的资金。");
    expect(all["reveal"]).toContain("当前账户私钥（导入的）");
    expect(all["privacyUnlock"]).toContain("解锁不会取消它");
    expect(all["folders"]).toContain("1 个成员");
    expect(all["hidden"]).toContain("隐藏的账户");
    expect(all["names"]).toContain("从此钱包的助记词派生 Mainnet 上的下一个账户。");
    expect(all["advanced"]).toContain("NFT 索引服务");
  });

  test("the leak check catches English", () => {
    expect(leaks(screens()["reveal"] ?? "").length).toBeGreaterThan(0);
  });

  test("English output is unchanged", () => {
    const all = screens();
    expect(all["dock"]).toContain("Version 1.2.3");
    expect(all["folders"]).toContain("1 member");
    expect(all["reveal"]).toContain("Active account private key (imported)");
  });
});
