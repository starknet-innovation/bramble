/** Neutral score copy and untrusted factor rendering. */
import { describe, expect, test } from "bun:test";
import { privacyScoreCard } from "../../../../src/sidepanel/journeys/privacy/privacy-score-view";

describe("privacy score card", () => {
  test("shows the conservative score, both set sizes, and the model caveat", () => {
    const html = privacyScoreCard({
      band: "moderate",
      candidateCount: 94,
      confidence: "high",
      effectiveAnonymitySet: 28,
      factors: ["no exact public amount match"],
      generatedAt: "2026-08-28T12:00:00.000Z",
      matchedWithdrawals: 2,
      maximumScore: 90,
      medianScore: 81,
      minimumScore: 72,
      score: 72,
      snapshotBlockNumber: 13_989_957,
      status: "available",
    });

    expect(html).toContain("Privacy 72 · Moderate");
    expect(html).toContain("Effective set</dt><dd>28");
    expect(html).toContain("Raw candidates</dt><dd>94");
    expect(html).toContain("not a guarantee of anonymity or safety");
  });

  test("escapes signed factor text and never displays stale scores", () => {
    const html = privacyScoreCard({
      band: "weak",
      candidateCount: 5,
      confidence: "low",
      effectiveAnonymitySet: 2,
      factors: ["<img src=x onerror=alert(1)>"],
      generatedAt: "2026-08-28T12:00:00.000Z",
      matchedWithdrawals: 1,
      maximumScore: 25,
      medianScore: 25,
      minimumScore: 25,
      score: 25,
      snapshotBlockNumber: 100,
      status: "available",
    });

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(privacyScoreCard({ status: "stale" })).toContain("Estimate stale");
    expect(privacyScoreCard({ status: "stale" })).not.toContain("/100");
  });
});
