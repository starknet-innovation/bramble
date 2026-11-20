/**
 * Recovery phrases for the two wallets that co-own the round's multisig. They
 * are computed from the funding account's signing key, so the one sncast
 * account is the only secret a developer has to keep: every run, from any
 * checkout, arrives at the same two owners and can sign for a multisig an
 * earlier run left funded. This is test tooling. The wallet itself still does
 * every derivation and signature from the phrase it is given.
 */
import { createHash } from "node:crypto";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

/** The two co-owners of the round's 2-of-2 multisig. */
export type OwnerRole = "a" | "b";

const DOMAIN = "bramble-mainnet-multisig-e2e/v1";

/**
 * The 12-word phrase of one owner. The same key and role always give the same
 * phrase; the two roles give unrelated phrases. Throws on a key that is not a
 * felt. The result is as sensitive as the funding key and must not be logged.
 */
export const ownerPhrase = (fundingPrivateKey: string, role: OwnerRole): string => {
  const key = canonicalFelt(fundingPrivateKey);
  if (key === null) {
    throw new Error("The funding account key is not a valid felt.");
  }
  const entropy = createHash("sha256").update(`${DOMAIN}/owner-${role}/${key}`).digest();
  return entropyToMnemonic(entropy.subarray(0, 16), wordlist);
};
