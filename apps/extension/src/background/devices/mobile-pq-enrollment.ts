/**
 * The proof-of-possession challenge a paired device must sign before the wallet
 * will enroll its public key.
 *
 * Why this exists at all: an account's address is derived from the key it is
 * enrolled with, so enrolling a key the device cannot sign for produces an
 * address nobody can spend from. Anything the user funds there is lost
 * permanently, and no later check recovers it. The signature over this challenge
 * is what rules that out.
 *
 * Why the challenge is random and single-use: a fixed one could be replayed. An
 * attacker holding any `(public key, signature)` pair over a predictable message
 * could enroll a key they do not control. So the wallet issues fresh bytes, keeps
 * exactly one issue outstanding, and consumes it on use — a second enrollment
 * attempt needs a second challenge.
 *
 * Held in memory only. A worker restart drops the outstanding challenge, which
 * fails the next enrollment closed rather than accepting a stale one.
 */

import { bytesToHex } from "@mc-wallet/core/hex";

/** Bytes of challenge the device signs. Matches the signed-message width. */
const CHALLENGE_BYTES = 32;

// The challenge travels as a felt — it is verified through the same path a
// transaction hash is, and padded back to 32 big-endian bytes for signing. A
// uniform 32-byte value exceeds the Stark field prime about 97% of the time, so
// the top six bits are cleared to keep every challenge inside the field. That
// leaves 250 bits of entropy, which is far more than replay resistance needs.
const FELT_TOP_BYTE_MASK = 0x03;

/**
 * Issues and consumes proof-of-possession challenges. `issue` replaces any
 * outstanding challenge, so the newest enrollment attempt is the only live one;
 * `consume` returns whether the supplied challenge was that one and clears it
 * either way, so no challenge is ever accepted twice.
 */
export type MobilePqEnrollment = {
  readonly issue: () => string;
  readonly consume: (challenge: string) => boolean;
};

/**
 * Creates the enrollment challenge holder. `randomBytes` is injected so the
 * flow is exercised deterministically in tests; it defaults to the platform CSPRNG.
 */
export const createMobilePqEnrollment = (
  randomBytes: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): MobilePqEnrollment => {
  let outstanding: string | null = null;
  return {
    consume(challenge) {
      const issued = outstanding;
      outstanding = null;
      return issued !== null && issued === challenge;
    },
    issue() {
      const bytes = randomBytes(CHALLENGE_BYTES);
      const first = bytes[0];
      if (first !== undefined) {
        bytes[0] = first & FELT_TOP_BYTE_MASK;
      }
      outstanding = `0x${bytesToHex(bytes)}`;
      return outstanding;
    },
  };
};
