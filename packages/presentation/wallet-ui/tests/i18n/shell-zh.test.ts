/**
 * The wallet chrome and the app-layer screens render in Simplified Chinese when
 * that is the UI language: their own sentences appear, no English sentence from
 * the shell catalogs leaks into the markup, and English output is unchanged.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { escapeHtml } from "@bramble/core/html";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { setUiLocale } from "../../src/i18n/locale";
import { uiCatalogs } from "../../src/i18n/messages";
import { scopeChangeAnnouncement } from "../../src/sidepanel/app/rendering/scene-renderer";
import {
  findAccountsFlow,
  importKeyFlow,
  importPhraseFlow,
} from "../../src/sidepanel/app/screens/flows";
import { addressBookFlow, connectedSitesFlow } from "../../src/sidepanel/app/screens/support-flows";
import { emptyStatus } from "../../src/sidepanel/runtime/runtime";
import { guardedCopyNote } from "../../src/sidepanel/shared/guarded-copy";
import { networkDataIssue } from "../../src/sidepanel/shared/network-status";
import { accountsDetectedText, noAccountEmpty } from "../../src/sidepanel/shared/parts";
import { walletViewLabel } from "../../src/sidepanel/shared/view-labels";
import { accountDrawer } from "../../src/sidepanel/shell/account-drawer";
import { updateReadyTitle } from "../../src/sidepanel/shell/update-banner";
import {
  pendingCallout,
  shieldTile,
  walletDock,
  walletHeader,
} from "../../src/sidepanel/shell/wallet-shell";

afterEach(() => setUiLocale("en"));

const status = { ...emptyStatus(), hasVault: true, network: "Starknet Mainnet", ready: true };
const preferences = {
  ...defaultWalletPreferences(),
  addressBook: [
    {
      address: "0x123",
      id: "c1",
      label: "Ada <b>",
      networkId: status.networkId,
      publicKeyX: "0x456",
    },
  ],
};

// Placeholder-free English shell sentences long enough not to collide with
// markup (ids, attribute names and tags are lowercase or short).
const englishSentences = Object.entries(uiCatalogs.en)
  .filter(([key, text]) => key.startsWith("shell.") && !text.includes("{"))
  .map(([, text]) => text)
  .filter((text) => text.length > 8);

const leaks = (html: string): readonly string[] =>
  englishSentences.filter((text) => html.includes(text) || html.includes(escapeHtml(text)));

const screens = (): Readonly<Record<string, string>> => ({
  addressBook: addressBookFlow(status, preferences),
  dock: walletDock("home", 2),
  drawer: accountDrawer(status, null, preferences),
  findAccounts: findAccountsFlow(status),
  header: walletHeader(status, null, preferences),
  importKey: importKeyFlow(status),
  importPhrase: importPhraseFlow(status),
  noAccount: noAccountEmpty(status),
  pending: pendingCallout(2),
  sites: connectedSitesFlow(status, [{ accountCount: 2, origin: "https://dapp.example" }]),
  sitesError: connectedSitesFlow(status, "error"),
  tile: shieldTile("SN_MAIN:STRK:0x1", false, false, false),
});

describe("wallet chrome in Simplified Chinese", () => {
  test("no English shell sentence reaches any rendered surface", () => {
    setUiLocale("zh-Hans");
    for (const [name, html] of Object.entries(screens())) {
      expect(leaks(html), name).toEqual([]);
    }
  });

  test("the leak check sees English when the UI is in English", () => {
    expect(leaks(screens()["sites"] ?? "").length).toBeGreaterThan(0);
  });

  test("Chinese sentences appear with their facts escaped", () => {
    setUiLocale("zh-Hans");
    const views = screens();
    expect(views["dock"]).toContain("首页");
    expect(views["header"]).toContain("锁定钱包");
    expect(views["pending"]).toContain("2 个连接请求待处理");
    expect(views["sites"]).toContain("已分享 2 个账户");
    expect(views["noAccount"]).toContain("Starknet Mainnet 上还没有账户");
    expect(views["addressBook"]).toContain("复制 Ada &lt;b&gt; 的签名者公钥");
    expect(views["addressBook"]).not.toContain("Ada <b>");
    expect(views["tile"]).toContain("转入隐私余额 — 先向此账户添加 STRK");
  });

  test("helpers and task labels follow the language", () => {
    setUiLocale("zh-Hans");
    expect(accountsDetectedText(3)).toBe("已找到 3 个");
    expect(walletViewLabel("send")).toBe("发送");
    expect(scopeChangeAnnouncement("network")).toBe("网络已更改。正在更新账户余额、活动和权限。");
    expect(updateReadyTitle()).toBe("有可用的更新");
    expect(guardedCopyNote(null)).toContain("Bramble 无法在此浏览器中清除剪贴板");
    expect(networkDataIssue({ balances: [], stale: true } as never, true, null, false)).toEqual([
      "正在使用已保存的余额。",
      "实时价格暂时不可用。",
    ]);
  });

  test("English output is unchanged", () => {
    expect(accountsDetectedText(3)).toBe("3 found");
    expect(walletViewLabel("shadow-accounts").length).toBeGreaterThan(0);
    expect(scopeChangeAnnouncement("account")).toBe(
      "Account changed. Updating account balances, activity, and permissions.",
    );
    expect(networkDataIssue({ balances: [], stale: true } as never, true, null, true)).toEqual([
      "Using saved balances.",
      "Using saved prices.",
    ]);
    expect(pendingCallout(1)).toContain("1 connection request waiting");
  });
});
