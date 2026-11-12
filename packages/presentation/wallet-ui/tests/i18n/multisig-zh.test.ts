/**
 * The multisig screens render in Simplified Chinese when that is the UI
 * language: their catalog sentences appear, and no English sentence from the
 * multisig catalogs leaks into the markup. Review cards (signing text) are out
 * of scope here and are not rendered.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { escapeHtml } from "@bramble/core/html";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { setUiLocale } from "../../src/i18n/locale";
import { uiCatalogs } from "../../src/i18n/messages";
import {
  alreadyDeployedMessage,
  deploymentReviewFailure,
} from "../../src/sidepanel/journeys/multisig/multisig-deploy-errors";
import {
  multisigDeployFlow,
  signerCountText,
} from "../../src/sidepanel/journeys/multisig/multisig-deploy-view";
import {
  multisigAddFlow,
  multisigReceiveFlow,
  multisigSignersFlow,
  multisigTrackFlow,
  multisigWatchFlow,
} from "../../src/sidepanel/journeys/multisig/multisig-management-views";
import {
  multisigDetailFlow,
  multisigProposeFlow,
  multisigsFlow,
} from "../../src/sidepanel/journeys/multisig/multisig-views";
import { makeArgentMultisigFixture } from "../support/argent-multisig-fixtures";

afterEach(() => setUiLocale("en"));

const zh: Readonly<Record<string, string>> = uiCatalogs["zh-Hans"];

// Every placeholder-free English multisig sentence that its translation changes.
// Short single words are left out: "Multisig" is also part of the product name
// "Ready Multisig 0.2", which stays in English.
const englishSentences = Object.entries(uiCatalogs.en)
  .filter(([key, text]) => key.startsWith("multisig.") && !text.includes("{"))
  .filter(
    ([key, text]) => zh[key] !== text && (text.includes(" ") ? text.length > 6 : text.length > 9),
  )
  .map(([, text]) => text);

// What a reader meets: text between tags plus the attributes that are read
// aloud or shown. Attribute names such as `tokenBalance` are not copy.
const readable = (html: string): string =>
  [
    html.replace(/<[^>]*>/g, " "),
    ...[...html.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/g)].map((match) => match[1]),
  ].join(" ");

const leaks = (html: string): readonly string[] => {
  const text = readable(html);
  return englishSentences.filter(
    (sentence) => text.includes(sentence) || text.includes(escapeHtml(sentence)),
  );
};

const screens = async (): Promise<Readonly<Record<string, string>>> => {
  const fixture = await makeArgentMultisigFixture();
  const account = fixture.status.accounts[0] ?? null;
  const preferences = defaultWalletPreferences();
  return {
    add: multisigAddFlow(fixture.status, account),
    deploy: multisigDeployFlow(fixture.status, account, true, preferences),
    home: multisigDetailFlow(
      fixture.status,
      account,
      fixture.view,
      [],
      false,
      preferences,
      "multisig-home",
    ),
    list: multisigsFlow(fixture.status, account, [fixture.view], []),
    propose: multisigProposeFlow(fixture.status, fixture.view, preferences),
    receive: multisigReceiveFlow(fixture.status, fixture.view),
    signers: multisigSignersFlow(fixture.status, account, fixture.view, preferences),
    track: multisigTrackFlow(fixture.status, fixture.view),
    watch: multisigWatchFlow(fixture.status, account),
  };
};

describe("multisig in Simplified Chinese", () => {
  test("no English multisig sentence reaches the account, setup or signer screens", async () => {
    setUiLocale("zh-Hans");
    for (const [name, html] of Object.entries(await screens())) {
      expect(leaks(html), name).toEqual([]);
    }
  });

  test("the main screens carry their Chinese copy", async () => {
    setUiLocale("zh-Hans");
    const { add, deploy, home, list, propose, signers } = await screens();
    expect(list).toContain("多签账户");
    expect(list).toContain("添加多签账户");
    expect(add).toContain("多个签名者共同批准");
    expect(deploy).toContain("参与者");
    expect(deploy).toContain("继续设置审批");
    expect(home).toContain("签名者");
    expect(home).toContain("共同签名者更新");
    expect(propose).toContain("检查交易");
    expect(signers).toContain("当前签名者");
  });

  test("the leak check would catch English", async () => {
    setUiLocale("en");
    expect(leaks((await screens())["list"] ?? "")).toContain("Add multisig account");
  });

  test("copy built at call time follows the active language", () => {
    setUiLocale("zh-Hans");
    expect(signerCountText(1)).toBe("1 个签名者");
    expect(signerCountText(3)).toBe("3 个签名者");
    expect(deploymentReviewFailure("contract already deployed")).toBe(alreadyDeployedMessage());
    expect(alreadyDeployedMessage()).toContain("此多签账户已部署");
    setUiLocale("en");
    expect(signerCountText(1)).toBe("1 signer");
    expect(signerCountText(3)).toBe("3 signers");
    expect(alreadyDeployedMessage()).toStartWith("This multisig is already deployed.");
  });
});
