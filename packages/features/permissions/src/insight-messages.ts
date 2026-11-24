/**
 * Site-reputation warnings shown on a connection or signing request: what the
 * wallet knows about the requesting site (blocklist, lookalike domain, risky
 * top-level domain, first visit).
 *
 * `originInsights` decides each warning as a reference (a key and its facts);
 * the English it has always returned is rendered from this catalog, and the
 * wallet UI renders the same reference in the reader's language. Facts (the
 * imitated domain, the top-level domain) are filled in by code.
 *
 * Trust boundary: these are security warnings. Each translation is pinned to
 * the English it was made from (`tests/insight-message-pins.ts`).
 */
import {
  type Catalog,
  isMessageRef,
  type MessageRef,
  type Placeholders,
  renderMessageRef,
} from "@bramble/core/i18n";

const en = {
  "siteInsight.blocklisted":
    "This domain is on the wallet blocklist of known phishing and scam sites.",
  "siteInsight.connectedBefore": "You have connected to this site before.",
  "siteInsight.firstSeen":
    "First time this wallet has seen this site; you have no prior history with it.",
  "siteInsight.lookalike": "Domain closely resembles {target}; watch for a spoofed lookalike.",
  "siteInsight.newSite": "This site was first seen less than a day ago.",
  "siteInsight.punycode":
    "Domain uses punycode (internationalized characters) that can mimic a real name.",
  "siteInsight.riskyTld": "The .{tld} top-level domain is frequently used for scams; be cautious.",
  "siteInsight.unparseable": "Origin could not be parsed as a valid site.",
} as const;

/** English and Simplified Chinese site warnings. */
export const insightMessages = {
  en,
  "zh-Hans": {
    "siteInsight.blocklisted": "此域名在钱包的已知钓鱼和诈骗网站黑名单中。",
    "siteInsight.connectedBefore": "你以前连接过此网站。",
    "siteInsight.firstSeen": "此钱包首次见到此网站；你与它没有任何往来记录。",
    "siteInsight.lookalike": "此域名与 {target} 极为相似；注意仿冒域名。",
    "siteInsight.newSite": "此网站首次出现距今不到一天。",
    "siteInsight.punycode": "此域名使用 punycode（国际化字符），可能冒充真实名称。",
    "siteInsight.riskyTld": ".{tld} 顶级域名常被用于诈骗；务必谨慎。",
    "siteInsight.unparseable": "无法将来源解析为有效网站。",
  } satisfies Catalog<keyof typeof en>,
};

/** A site-warning id. */
export type InsightMessageKey = keyof typeof en;

/** Whether a string names a site warning. */
export const isInsightMessageKey = (key: string): key is InsightMessageKey =>
  Object.hasOwn(en, key);

/** Builds a site-warning reference, typed by its English template. */
export const insightText = <K extends InsightMessageKey>(
  key: K,
  ...args: [Placeholders<(typeof en)[K]>] extends [never]
    ? []
    : [facts: Readonly<Record<Placeholders<(typeof en)[K]>, string>>]
): MessageRef => ({ key, facts: args[0] ?? {} });

/** The English of a site warning. */
export const insightEnglish = (text: MessageRef): string =>
  renderMessageRef(text, (key) => (isInsightMessageKey(key) ? en[key] : undefined));

/** Validates a site-warning reference from another extension context. */
export const isInsightText = (value: unknown): value is MessageRef =>
  isMessageRef(value, isInsightMessageKey);
