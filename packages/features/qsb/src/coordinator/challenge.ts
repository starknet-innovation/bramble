/**
 * The QSB coordinator's sign-in challenge, and the one check that decides
 * whether the owner key may sign it. A BIP-322 proof over this message opens
 * a session; it authorizes no Bitcoin transaction, and the message says so.
 *
 * Trust boundary: the message is the coordinator's text and trusted for
 * nothing. It is signed only when it is exactly the session-only message for
 * this origin, this address and Bitcoin mainnet (qsb-app `sdk/client.ts`
 * `signInMessage`), and its expiry is still ahead, by at most the five
 * minutes a challenge lives, on the caller's injected clock. Anything else is
 * refused before the key is touched.
 */
import { parseIsoInstant } from "./instant";
import { QSB_COORDINATOR_ORIGIN } from "./origin";

/** How long a coordinator challenge lives (`CHALLENGE_SECONDS`), in milliseconds. */
export const QSB_CHALLENGE_LIFETIME_MS = 300_000;

/**
 * Why a challenge may not be signed: `shape` (not the exact session-only
 * message for this origin and address), `expired` (its expiry is not after
 * now) or `too-far` (it expires more than {@link QSB_CHALLENGE_LIFETIME_MS}
 * from now, which no fresh challenge does).
 */
export type QsbChallengeRefusal = "expired" | "shape" | "too-far";

const escapePattern = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// qsb-app's pattern, verbatim but for the expiry, captured to be checked.
const sessionOnlyMessage = (address: string): RegExp =>
  new RegExp(
    `^QSB Vault sign-in\\nOrigin: ${escapePattern(QSB_COORDINATOR_ORIGIN)}\\nAddress: ${escapePattern(address)}\\nNetwork: bitcoin-mainnet\\nNonce: [0-9a-f-]{36}\\nExpires: ([^\\n]{1,40})\\nThis signature authorizes this session only\\. It does not authorize a Bitcoin transaction\\.$`,
  );

/**
 * Checks a challenge for `address` at `nowMs` (epoch milliseconds from the
 * caller's clock). Returns null when it may be signed, else the reason it
 * may not. Total: any value that is not such a string is `shape`.
 */
export const qsbChallengeRefusal = (
  message: unknown,
  address: string,
  nowMs: number,
): QsbChallengeRefusal | null => {
  const expires =
    typeof message === "string" ? sessionOnlyMessage(address).exec(message)?.[1] : undefined;
  const expiresAt = expires === undefined ? null : parseIsoInstant(expires);
  if (expiresAt === null) {
    return "shape";
  }
  if (expiresAt <= nowMs) {
    return "expired";
  }
  return expiresAt - nowMs > QSB_CHALLENGE_LIFETIME_MS ? "too-far" : null;
};
