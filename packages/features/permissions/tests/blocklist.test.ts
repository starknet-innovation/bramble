/**
 * Blocklist and site-reputation heuristic checks: blocked domains, punycode,
 * digit-substitution / hyphen-insertion / edit-distance / substring lookalikes,
 * risky TLDs, protected domains that must never be flagged, and the injected
 * reputation context (first-seen and prior-connection).
 */
import { describe, expect, test } from "bun:test";
import { isBlockedOrigin, originInsights } from "@bramble/permissions/blocklist";

const DAY_MS = 86_400_000;

const warns = (origin: string, needle: string, context = {}): boolean =>
  originInsights(origin, context).warnings.some((warning) => warning.includes(needle));

describe("isBlockedOrigin", () => {
  test("blocks vendored known-bad domains and their subdomains", () => {
    expect(isBlockedOrigin("https://starknet-airdrop.com")).toBe(true);
    expect(isBlockedOrigin("https://www.starknet-airdrop.com")).toBe(true);
    expect(isBlockedOrigin("https://braavos-airdrop.com")).toBe(true);
  });

  test("blocks a fully-qualified blocklisted host", () => {
    expect(isBlockedOrigin("https://starknet-airdrop.com.")).toBe(true);
    expect(isBlockedOrigin("https://www.starknet-airdrop.com.")).toBe(true);
  });

  test("does not block legitimate or unparseable origins", () => {
    expect(isBlockedOrigin("https://starknet.io")).toBe(false);
    expect(isBlockedOrigin("https://app.argent.xyz")).toBe(false);
    expect(isBlockedOrigin("not a url")).toBe(false);
  });
});

describe("originInsights", () => {
  test("flags blocklisted origins as blocked with a blocklist warning", () => {
    const insight = originInsights("https://starknet-airdrop.com");
    expect(insight.blocked).toBe(true);
    expect(insight.warnings.some((warning) => warning.includes("blocklist"))).toBe(true);
  });

  test("warns on punycode / internationalized domains", () => {
    expect(warns("https://xn--pple-43d.com", "punycode")).toBe(true);
  });

  test("detects digit-substitution lookalikes", () => {
    expect(warns("https://st4rknet.io", "resembles starknet.io")).toBe(true);
  });

  test("detects hyphen-insertion lookalikes", () => {
    expect(warns("https://star-knet.io", "resembles starknet.io")).toBe(true);
  });

  test("detects single-edit-distance lookalikes", () => {
    expect(warns("https://starkne.io", "resembles starknet.io")).toBe(true);
    expect(warns("https://argnt.xyz", "resembles argent.xyz")).toBe(true);
  });

  test("detects brand names smuggled into another registrable domain", () => {
    expect(warns("https://starknet.io.evil-phish.com", "resembles starknet.io")).toBe(true);
  });

  test("warns on high-risk top-level domains", () => {
    expect(warns("https://random-dapp.zip", "top-level domain")).toBe(true);
  });

  test("never flags a protected domain or its subdomains as a lookalike", () => {
    const insight = originInsights("https://app.starknet.io", { connected: true });
    expect(insight.blocked).toBe(false);
    expect(insight.warnings.some((warning) => warning.includes("resembles"))).toBe(false);
    expect(originInsights("https://argent.xyz", { connected: true }).warnings).toEqual([
      "You have connected to this site before.",
    ]);
  });

  test("reports first-seen, prior-connection, and recency reputation", () => {
    expect(warns("https://example.com", "First time")).toBe(true);
    expect(warns("https://example.com", "connected to this site before", { connected: true })).toBe(
      true,
    );
    expect(
      warns("https://example.com", "first seen less than a day ago", {
        firstSeenAt: 1_000,
        now: 1_000 + DAY_MS - 1,
      }),
    ).toBe(true);
  });

  test("stays quiet for a known, long-seen, reputable origin", () => {
    expect(
      originInsights("https://example.com", { firstSeenAt: 0, now: DAY_MS + 1 }).warnings,
    ).toEqual([]);
  });

  test("returns a parse warning for unparseable origins without blocking", () => {
    const insight = originInsights("not a url");
    expect(insight.blocked).toBe(false);
    expect(insight.warnings).toEqual(["Origin could not be parsed as a valid site."]);
  });
});
