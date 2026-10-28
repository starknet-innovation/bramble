/**
 * Shared SNIP-9 execution-window check. The private paymaster and gasless
 * fees both sign an outside execution, so they use one clock check rather
 * than two copies that can drift.
 */

const MAX_U64 = (1n << 64n) - 1n;

/**
 * Whether the outside-execution window is live at `nowSeconds` and still has
 * at least `minimumRemainingSeconds` left. False when the bounds cannot be
 * read. `executeAfter` and `executeBefore` are unix seconds.
 */
export const isPaymasterAuthorizationLive = (
  authorization: { readonly executeAfter: string; readonly executeBefore: string },
  nowSeconds: number,
  minimumRemainingSeconds = 0n,
): boolean => {
  try {
    const after = BigInt(authorization.executeAfter);
    const before = BigInt(authorization.executeBefore);
    const now = BigInt(nowSeconds);
    return (
      Number.isSafeInteger(nowSeconds) &&
      nowSeconds >= 0 &&
      after >= 0n &&
      before <= MAX_U64 &&
      after < now &&
      now < before &&
      before - now >= minimumRemainingSeconds
    );
  } catch {
    return false;
  }
};
