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

/**
 * Where the scalar sits: the `viewing_key` felt of
 * `compile_actions(user, viewing_key, actions)`, the one pool call a multisig
 * CallSet carries. The scalar is never a recipient, token, or channel key, so
 * a scalar or marker anywhere else is refused in both directions (#1073):
 * restored there, a co-owner's package could show the shared key as an address
 * and publish it on chain.
 */
const KEY_SLOT = 1;

const canonicalList = (calldata: readonly string[]): readonly string[] | null => {
  const canonical = calldata.map((felt) => canonicalFelt(felt));
  return canonical.every((felt): felt is string => felt !== null) ? canonical : null;
};

// True when `felt` appears in `calldata` exactly once, in the key slot.
const onlyInKeySlot = (calldata: readonly string[], felt: string): boolean =>
  calldata[KEY_SLOT] === felt && calldata.indexOf(felt) === calldata.lastIndexOf(felt);

/**
 * Replaces the scalar in the key slot with the redaction marker. Returns null
 * when the calldata is not canonical felts, the scalar is the marker, the
 * marker is already present, or the scalar is anywhere but the key slot.
 */
export const redactStrk20Calldata = (
  calldata: readonly string[],
  scalar: string,
): readonly string[] | null => {
  const canonical = canonicalList(calldata);
  const key = canonicalFelt(scalar);
  if (!canonical || key === null || key === MULTISIG_STRK20_REDACTED_FELT) return null;
  if (canonical.includes(MULTISIG_STRK20_REDACTED_FELT)) return null;
  if (!onlyInKeySlot(canonical, key)) return null;
  return canonical.map((felt, index) =>
    index === KEY_SLOT ? MULTISIG_STRK20_REDACTED_FELT : felt,
  );
};

/**
 * Puts `scalar` back in place of the redaction marker. Returns null when the
 * stored calldata already contains the scalar, which means it was not
 * redacted, or when the marker is anywhere but the key slot.
 */
export const restoreStrk20Calldata = (
  calldata: readonly string[],
  scalar: string,
): readonly string[] | null => {
  const canonical = canonicalList(calldata);
  const key = canonicalFelt(scalar);
  if (!canonical || key === null || key === MULTISIG_STRK20_REDACTED_FELT) return null;
  if (canonical.includes(key)) return null;
  if (!onlyInKeySlot(canonical, MULTISIG_STRK20_REDACTED_FELT)) return null;
  return canonical.map((felt, index) => (index === KEY_SLOT ? key : felt));
};
