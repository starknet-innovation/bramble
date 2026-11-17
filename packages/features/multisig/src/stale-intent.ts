/** Marking an Argent multisig intent stale (mc-wallet 673). */

import type { ArgentMultisigSigningIntent } from "./repository-schema";
import type { ArgentMultisigStaleReason } from "./stale-reason";

/**
 * The intent marked stale for `reason`. A `fee` reason never replaces a
 * recorded `nonce` or `config` one: once a co-signer may have sent it, a later
 * fee refusal cannot make that untrue. Pure; never throws.
 */
export const staleArgentMultisigIntent = (
  intent: ArgentMultisigSigningIntent,
  reason: ArgentMultisigStaleReason,
): ArgentMultisigSigningIntent => ({
  ...intent,
  staleReason:
    reason === "fee" && intent.staleReason !== undefined && intent.staleReason !== "fee"
      ? intent.staleReason
      : reason,
  state: "stale",
});
