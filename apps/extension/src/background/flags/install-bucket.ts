/**
 * RNG boundary for the feature-flag rollout bucket.
 *
 * The only randomness the flag client uses: one uniform integer in [0, 9999],
 * drawn once per install, stored locally by `@mc-wallet/flags/state`, and
 * never sent anywhere. It is not an identifier the wallet transmits and not
 * secret material; it only decides which side of a rollout percentage this
 * install lands on.
 */

const BUCKETS = 10_000;
// Largest multiple of BUCKETS that fits in a uint32. Draws at or above it are
// rejected so every bucket is exactly equally likely (no modulo bias).
const UNBIASED_LIMIT = Math.floor(0x1_0000_0000 / BUCKETS) * BUCKETS;

/**
 * Draws one uniform rollout bucket from `crypto.getRandomValues`. Throws only
 * if the platform RNG does; the caller then falls back to bundled defaults.
 */
export const drawInstallBucket = (): number => {
  const word = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(word);
    const value = word[0] ?? UNBIASED_LIMIT;
    if (value < UNBIASED_LIMIT) {
      return value % BUCKETS;
    }
  }
};
