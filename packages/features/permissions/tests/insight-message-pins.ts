/**
 * SHA-256 prefixes (16 hex digits) of the English each site-warning
 * translation was made from. See `insight-messages.test.ts`.
 */
export const INSIGHT_MESSAGE_PINS: Readonly<Record<string, string>> = {
  "siteInsight.blocklisted": "c9840341c1b41952",
  "siteInsight.connectedBefore": "b35cb2db5ff21b7d",
  "siteInsight.firstSeen": "04a5fdde8c70895c",
  "siteInsight.lookalike": "2ba7289023bc3e8d",
  "siteInsight.newSite": "3b78f8449d6e24b2",
  "siteInsight.punycode": "ae6c9036405df210",
  "siteInsight.riskyTld": "d8e02e0a0f07ea9e",
  "siteInsight.unparseable": "b1956b7014024e40",
};
