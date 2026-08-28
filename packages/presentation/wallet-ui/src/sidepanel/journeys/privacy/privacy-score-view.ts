/** Compact home-card rendering for locally attributed withdrawal scores. */
import { escapeHtml } from "@mc-wallet/core/html";
import type { PrivacyScoreBand, PrivacyScoreState } from "@mc-wallet/privacy/score-types";

const BAND_LABELS: Readonly<Record<PrivacyScoreBand, string>> = {
  "highly-linkable": "Highly linkable",
  moderate: "Moderate",
  stronger: "Stronger",
  weak: "Weak",
};

const effectiveSet = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const scoreText = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const unavailableCard = (title: string, copy: string): string => `
  <section class="privacy-score-card" aria-label="Estimated withdrawal privacy">
    <span class="privacy-score-eyebrow">Estimated withdrawal privacy</span>
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(copy)}</p>
  </section>`;

/**
 * Renders a neutral estimate with raw/effective set distinction and a durable
 * experimental-model caveat. Unsupported networks intentionally render no
 * card because the publisher currently covers Mainnet only.
 */
export const privacyScoreCard = (score: PrivacyScoreState | undefined): string => {
  if (!score || score.status === "unsupported") {
    return "";
  }
  if (score.status === "no-withdrawals") {
    return unavailableCard(
      "No scored withdrawals",
      "Your estimate will appear after an unshield is included in a finalized score snapshot.",
    );
  }
  if (score.status === "pending") {
    return unavailableCard(
      "Score pending",
      "A recent unshield is waiting for the next finalized score snapshot.",
    );
  }
  if (score.status === "stale") {
    return unavailableCard(
      "Estimate stale",
      "The newest verified score snapshot is too old to present as current.",
    );
  }
  if (score.status === "unavailable") {
    return unavailableCard(
      "Estimate unavailable",
      "The signed public score could not be verified right now.",
    );
  }
  if (score.status !== "available") {
    return "";
  }
  const range =
    score.minimumScore === score.maximumScore
      ? scoreText(score.score)
      : `${scoreText(score.minimumScore)}–${scoreText(score.maximumScore)}`;
  const headline = scoreText(score.score);
  return `
  <details class="privacy-score-card">
    <summary>
      <span>
        <span class="privacy-score-eyebrow">Estimated withdrawal privacy</span>
        <strong>Privacy ${headline} · ${BAND_LABELS[score.band]}</strong>
      </span>
      <span class="privacy-score-number">${headline}<small>/100</small></span>
    </summary>
    <div class="privacy-score-details">
      <p>Conservative lowest score across ${score.matchedWithdrawals} locally matched withdrawal${score.matchedWithdrawals === 1 ? "" : "s"}. Range ${range}; median ${scoreText(score.medianScore)}.</p>
      <dl>
        <div><dt>Effective set</dt><dd>${effectiveSet(score.effectiveAnonymitySet)}</dd></div>
        <div><dt>Raw candidates</dt><dd>${score.candidateCount}</dd></div>
        <div><dt>Evidence</dt><dd>${escapeHtml(score.confidence)}</dd></div>
        <div><dt>Snapshot</dt><dd>Block ${score.snapshotBlockNumber}</dd></div>
      </dl>
      <ul>${score.factors.map((factor) => `<li>${escapeHtml(factor)}</li>`).join("")}</ul>
      <p class="privacy-score-caveat">Experimental linkability estimate, not a guarantee of anonymity or safety.</p>
    </div>
  </details>`;
};
