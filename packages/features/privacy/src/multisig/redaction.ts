/**
 * Removes the multisig's shared STRK20 scalar from pool calldata before that
 * calldata is stored or sent to a co-owner. The scalar is put back only while
 * recomputing the CallSet digest, inside the vault boundary.
 */

import { canonicalFelt } from "@bramble/wallet-model/networks";

/**
 * Stand-in felt written wherever the shared scalar appeared. It is the ASCII
 * short string `redacted` and is rejected if the original calldata already
 * contains it, so restoration cannot invent a felt the pool did not sign.
 */
export const MULTISIG_STRK20_REDACTED_FELT = "0x7265646163746564";

const canonicalList = (calldata: readonly string[]): readonly string[] | null => {
  const canonical = calldata.map((felt) => canonicalFelt(felt));
  return canonical.every((felt): felt is string => felt !== null) ? canonical : null;
};

/**
 * Replaces every felt equal to `scalar` with the redaction marker. Returns
 * null when the calldata is not canonical felts, the scalar is the marker, or
 * the marker is already present.
 */
export const redactStrk20Calldata = (
  calldata: readonly string[],
  scalar: string,
): readonly string[] | null => {
  const canonical = canonicalList(calldata);
  const key = canonicalFelt(scalar);
  if (!canonical || key === null || key === MULTISIG_STRK20_REDACTED_FELT) return null;
  if (canonical.includes(MULTISIG_STRK20_REDACTED_FELT)) return null;
  return canonical.map((felt) => (felt === key ? MULTISIG_STRK20_REDACTED_FELT : felt));
};

/**
 * Puts `scalar` back in place of the redaction marker. Returns null when the
 * stored calldata already contains the scalar, which means it was not redacted.
 */
export const restoreStrk20Calldata = (
  calldata: readonly string[],
  scalar: string,
): readonly string[] | null => {
  const canonical = canonicalList(calldata);
  const key = canonicalFelt(scalar);
  if (!canonical || key === null || key === MULTISIG_STRK20_REDACTED_FELT) return null;
  if (canonical.includes(key)) return null;
  return canonical.map((felt) => (felt === MULTISIG_STRK20_REDACTED_FELT ? key : felt));
};
