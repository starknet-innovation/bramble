/**
 * The privacy surfaces' copy for the mobile apps (docs/privacy.md §2, fixture 6), read from the
 * extension's rendered templates, and the Swift/Kotlin tables rendered from it. Only the two
 * `mobileOnly` strings are not the extension's: the "Unsupported" blocker (§2.7), listed apart so
 * the drift test and product sign-off can enumerate them.
 */

import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import { PRIVACY_DEPLOY_REQUIRED } from "@bramble/wallet-protocol/privacy-blocker";
import type { WalletStatus } from "../packages/presentation/wallet-ui/src/popup/responses/responses";
import { homeTabs } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/home-tabs";
import { homeScreen } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/portfolio/home-view";
import type { PrivacyBlockerKind } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/privacy/privacy-model";
import { privacyFlow } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/privacy/privacy-views";
import { privacyPoolNotice } from "../packages/presentation/wallet-ui/src/sidepanel/journeys/send/receive-view";
import { privacyDataIssue } from "../packages/presentation/wallet-ui/src/sidepanel/shared/network-status";
import { shieldTile } from "../packages/presentation/wallet-ui/src/sidepanel/shell/wallet-shell";
import { disclosureFor } from "./mobile-privacy-gates";

/** Repository-relative paths of the generated copy tables. */
export const PRIVACY_COPY_SWIFT_PATH = "mobile/ios/Bramble/Privacy/PrivacyCopy.generated.swift";
export const PRIVACY_COPY_KOTLIN_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/privacy/PrivacyCopy.generated.kt";

/** The two strings mobile adds (docs/privacy.md §2.7), pending product sign-off. */
export const PRIVACY_MOBILE_ONLY = {
  unsupportedBody:
    "Activating, shielding and private sends need the Bramble extension for now. Your private balance is safe and visible here.",
  unsupportedTitle: "Not available in the mobile app yet",
} as const;

const preferences = defaultWalletPreferences();
const eth = preferences.tokens.find((t) => t.networkId === "SN_MAIN" && t.symbol === "ETH");
const strk = preferences.tokens.find((t) => t.networkId === "SN_MAIN" && t.symbol === "STRK");
const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const ENTITIES: Readonly<Record<string, string>> = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};
const decode = (text: string): string =>
  text.replace(/&#39;|&amp;|&gt;|&lt;|&quot;/g, (entity) => ENTITIES[entity] ?? entity);
const texts = (html: string): string[] =>
  html
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .split(/<[^>]+>/)
    .map((part) => decode(part.replace(/\s+/g, " ").trim()))
    .filter((part) => part.length > 0);
const pick = (html: string, pattern: RegExp): string => {
  const found = pattern.exec(html)?.[1];
  if (found === undefined) throw new Error(`copy not found: ${pattern}`);
  return decode(found.replace(/\s+/g, " ").trim());
};
const tokenId = eth?.id ?? "";

const flow = (journey: Parameters<typeof privacyFlow>[2]): string =>
  privacyFlow(status, preferences, journey);
const blocked = (kind: PrivacyBlockerKind) => {
  const html = flow({ blocker: { kind, message: "HINT" }, stage: "blocked", tokenId });
  const buttons = [...html.matchAll(/<button[\s\S]*?<\/button>/g)].map((m) =>
    texts(m[0]).join(" "),
  );
  return {
    action: buttons.find((label) => label !== "" && label !== "Back to wallet") ?? "",
    body: pick(html, /<h2>[^<]*<\/h2>\s*<p>([^<]*)<\/p>/),
    title: pick(html, /<h2>([^<]*)<\/h2>/),
  };
};

const rowHtml = (reading: Parameters<typeof disclosureFor>[0]): string =>
  homeTabs(
    { balances: eth ? [{ ...eth, balance: "1", formatted: "1" }] : [] },
    preferences,
    {},
    {},
    "usd",
    disclosureFor(reading),
    true,
  );
// The private line of a row: the second breakdown value (the first is the public balance).
const rowLine = (reading: Parameters<typeof disclosureFor>[0]): string =>
  decode(
    [
      ...rowHtml(reading).matchAll(/<span class="token-breakdown-value">([^<]*)<\/span>/g),
    ][1]?.[1] ?? "",
  );

/** Every privacy string the mobile screens show, keyed as the generated tables name it. */
export const computePrivacyCopy = (gates: {
  readonly journeys: readonly { readonly deploymentRead: string; readonly detail: string | null }[];
  readonly static: readonly {
    readonly deployment: string;
    readonly detail: { readonly actions: readonly string[] };
    readonly reading: string;
  }[];
}) => {
  const actions = (reading: string) =>
    gates.static.find((row) => row.reading === reading && row.deployment === "deployed")?.detail
      .actions ?? [];
  const [detailShield = "", detailUnshield = ""] = actions("registered");
  const [detailGoPrivate = ""] = actions("unregistered");
  const preparing = flow({ progress: null, stage: "preparing", step: "discovering", tokenId });
  const failedHome = homeTabs(
    { balances: [] },
    preferences,
    {},
    {},
    "usd",
    disclosureFor("failed"),
  );
  const registeredHome = homeTabs(
    { balances: eth ? [{ ...eth, balance: "1", formatted: "1" }] : [] },
    preferences,
    {},
    {},
    "usd",
    disclosureFor("registered"),
    true,
  );
  const hero = homeScreen(
    status,
    account,
    { balances: [] },
    0,
    true,
    preferences,
    {},
    {},
    "usd",
    disclosureFor("registered"),
  );
  const notice = (action: "deploy-first" | "fund-first" | "register") =>
    texts(privacyPoolNotice(disclosureFor("unregistered"), action));
  const tile = (...args: Parameters<typeof shieldTile>) => shieldTile(...args);
  const aria = (html: string) => pick(html, /aria-label="([^"]*)"/);
  const label = (html: string) => pick(html, /<span class="tile-label">([^<]*)<\/span>/);
  const kinds: PrivacyBlockerKind[] = ["deploy", "fund", "ledger", "network", "pending", "service"];
  const blockers = Object.fromEntries(kinds.map((kind) => [kind, blocked(kind)]));
  const [registerTitle, registerBody, registerAction] = notice("register");
  const [, fundBody] = notice("fund-first");
  const [, deployBody] = notice("deploy-first");
  const copy: Record<string, string> = {
    backToWallet: pick(preparing, /id="privacy-cancel"[^>]*>([^<]*)</),
    deployRequired: PRIVACY_DEPLOY_REQUIRED,
    deploymentUnchecked:
      gates.journeys.find((row) => row.deploymentRead === "throws")?.detail ?? "",
    detailGoPrivate,
    detailShield,
    detailUnshield,
    headerJourney: pick(
      flow({ blocker: { kind: "service", message: "" }, stage: "blocked", tokenId }),
      /<h1[^>]*>([^<]*)<\/h1>/,
    ),
    heroShielded: pick(hero, /<p class="hero-stale">[\s\S]*?<span>([^<]*)<\/span>/),
    lineDiscovering: rowLine("loading"),
    lineUnavailable: rowLine("failed"),
    noticeDeployFirstBody: deployBody ?? "",
    noticeFundFirstBody: fundBody ?? "",
    noticeRegisterAction: registerAction ?? "",
    noticeRegisterBody: registerBody ?? "",
    noticeTitle: registerTitle ?? "",
    preparingHint: pick(preparing, /id="privacy-liveness">([^<]*)</),
    preparingTitle: pick(preparing, /<h2>([^<]*)<\/h2>/),
    privateBalance: pick(
      registeredHome,
      /token-breakdown-label">[^<]*<svg[\s\S]*?<\/svg>([^<]*)<\/span>/,
    ),
    privateBalances: pick(failedHome, /private-balance-label">[\s\S]*?<span>([^<]*)<\/span>/),
    publicBalance: pick(
      registeredHome,
      /<span class="token-breakdown-label">(Public balance)<\/span>/,
    ),
    registerToStart: pick(
      rowHtml("unregistered"),
      /token-breakdown-register[\s\S]*?<\/span>\s*<span>([^<]*)<\/span>/,
    ),
    retry: pick(failedHome, /data-privacy-retry[\s\S]*?<span class="token-fiat">([^<]*)<\/span>/),
    statusRefreshing:
      privacyDataIssue("home", account, status, disclosureFor("loading"), false) ?? "",
    statusUnavailable:
      privacyDataIssue("home", account, status, disclosureFor("failed"), false) ?? "",
    tileActivateAria: aria(tile(strk?.id ?? "", false, true, true)),
    tileDeployLabel: label(tile(strk?.id ?? "", false, false, true)),
    tileFundAria: aria(tile(strk?.id ?? "", false, false, false)),
    tileFundLabel: label(tile(strk?.id ?? "", false, false, false)),
    tileNoTokenAria: aria(tile(null, false)),
    tileReadyAria: aria(tile(strk?.id ?? "", true, true, true)),
    tileShieldLabel: label(tile(strk?.id ?? "", true, true, true)),
    ...Object.fromEntries(
      kinds.flatMap((kind) => {
        const entry = blockers[kind] ?? { action: "", body: "", title: "" };
        const key = kind.charAt(0).toUpperCase() + kind.slice(1);
        return [
          [`blocked${key}Title`, entry.title],
          [`blocked${key}Body`, entry.body],
          [`blocked${key}Action`, entry.action],
        ];
      }),
    ),
    ...Object.fromEntries(
      texts(preparing.split('<ol class="privacy-task-list">')[1]?.split("</ol>")[0] ?? "").map(
        (task, index) => [`preparingTask${index + 1}`, task],
      ),
    ),
  };
  const later = {
    failure: texts(flow({ error: "ERROR", stage: "failure", tokenId })),
    proving: texts(flow({ progress: null, stage: "preparing", step: "proving", tokenId })),
    success: texts(
      flow({ hash: "0x1", kind: "register", stage: "success", symbol: "ETH", tokenId }),
    ),
  };
  return { later, mobileOnly: PRIVACY_MOBILE_ONLY, strings: copy };
};

const swiftString = (value: string): string => JSON.stringify(value);

/** The Swift and Kotlin copy tables for a copy section (from the committed fixture). */
export const renderPrivacyCopy = (copy: {
  readonly mobileOnly: Record<string, string>;
  readonly strings: Record<string, string>;
}): { readonly kotlin: string; readonly swift: string } => {
  const entries = [...Object.entries(copy.strings), ...Object.entries(copy.mobileOnly)].sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const header =
    "Generated by scripts/generate-mobile-privacy-vectors.ts from the extension's privacy surfaces. Do not edit.";
  const swift = [
    `// ${header}`,
    "",
    "/// The extension's privacy strings (`extension-privacy-copy.json`). `unsupported*` are the two",
    "/// mobile-only strings (docs/privacy.md §2.7).",
    "enum PrivacyCopy {",
    ...entries.map(([key, value]) => `    static let ${key} = ${swiftString(value)}`),
    "}",
    "",
  ].join("\n");
  const kotlin = [
    `// ${header}`,
    "package org.bramble.wallet.privacy",
    "",
    "/** The extension's privacy strings; `unsupported*` are the two mobile-only strings. */",
    "object PrivacyCopy {",
    ...entries.map(
      ([key, value]) => `    const val ${key} = ${JSON.stringify(value).replaceAll("$", "\\$")}`,
    ),
    "}",
    "",
  ].join("\n");
  return { kotlin, swift };
};
