/**
 * Where a new signing intent fits in the bounded multisig store.
 *
 * The store holds `MAX_INTENTS` intents across every multisig, and at most
 * `MAX_INTENTS_PER_MULTISIG` for any one of them. The per-multisig bound keeps
 * the proposals one co-signer can push over relay sync inside that co-signer's
 * own multisig, so they can never block preparing, importing or signing on any
 * other (Sherlock 179). Only settled intents (accepted, rejected, stale) are
 * ever evicted to make room; open ones never are.
 */
import type { ArgentMultisigSigningIntent } from "./repository-schema";

/** Intents the store holds across every multisig. */
export const MAX_INTENTS = 100;

/** Intents the store holds for any one multisig. */
export const MAX_INTENTS_PER_MULTISIG = 25;

/** An intent whose outcome is settled, so it may be evicted to make room. */
export const isTerminalIntent = (intent: ArgentMultisigSigningIntent): boolean =>
  intent.state === "accepted" || intent.state === "rejected" || intent.state === "stale";

/**
 * Places a new intent: it fits, it fits once the settled intent at `evict` is
 * dropped, or the store is full. A multisig at its own bound only ever evicts
 * one of its own intents.
 */
export const intentPlacement = (
  intents: readonly ArgentMultisigSigningIntent[],
  accountId: string,
): { readonly evict?: number; readonly fits: boolean } => {
  const sameAccount = (intent: ArgentMultisigSigningIntent) => intent.accountId === accountId;
  if (intents.filter(sameAccount).length >= MAX_INTENTS_PER_MULTISIG) {
    const evict = intents.findIndex((intent) => sameAccount(intent) && isTerminalIntent(intent));
    return evict < 0 ? { fits: false } : { evict, fits: true };
  }
  if (intents.length >= MAX_INTENTS) {
    const evict = intents.findIndex(isTerminalIntent);
    return evict < 0 ? { fits: false } : { evict, fits: true };
  }
  return { fits: true };
};
