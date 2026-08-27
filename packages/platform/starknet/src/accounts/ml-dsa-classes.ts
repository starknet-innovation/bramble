/**
 * What each ML-DSA account contract needs from the wallet. One family, several
 * contracts: the on-chain work of checking a post-quantum signature can be
 * arranged in more than one way, and which arrangement wins is still being
 * measured against real gas.
 *
 * Everything the wallet does *around* a signature is identical across them —
 * the phone signs the same 32 big-endian bytes of the transaction hash with an
 * empty FIPS 204 context, returns the same 3309-byte signature, and the
 * extension verifies it against the same 1952-byte public key before broadcast.
 * They differ in exactly three things, which is why this table exists rather
 * than a fourth account family:
 *
 *   1. what the constructor takes, and therefore the address preimage,
 *   2. whether there is a single class hash to pin, or one class per user,
 *   3. how many felts of signature calldata a transaction carries.
 *
 * A full `Record` for the same reason as the other contract tables here: adding
 * a contract fails to compile until every column is answered for it, rather
 * than silently inheriting another contract's answers.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { MlDsaKind } from "@mc-wallet/wallet-model/accounts";
import { hash } from "starknet";

/**
 * Where an account's class hash comes from.
 *
 * `per-user` means the verification key is compiled into the class, so every
 * account has its own class and there is no pinned release to compare a
 * deployed class against — the class hash *is* the commitment to the public key.
 * `shared` means one class serves every account of that contract, so it can be
 * pinned once the contract has a reviewed release.
 */
export type MlDsaClassHashSource = "per-user" | "shared";

/**
 * One ML-DSA contract's requirements.
 */
export type MlDsaClassSpec = {
  /**
   * Total felts a transaction's signature field carries, or null when it is not
   * fixed. Used to check an assembled signature before it is submitted, and to
   * state the data-availability cost of this contract honestly.
   */
  readonly signatureFelts: number | null;
  readonly classHashSource: MlDsaClassHashSource;
  /**
   * Constructor calldata for a new account of this contract, from its encoded
   * public key — or null when deriving it needs work the wallet cannot do yet.
   * A null here is why `deploymentInputs` refuses rather than guesses: an
   * address derived from the wrong preimage is an address nobody holds the key
   * for, and funds sent to it are stranded permanently.
   */
  readonly constructorCalldata: ((publicKey: string) => readonly string[]) | null;
};

// The verification-key expansion these two need — the 925-felt packed form of a
// 1952-byte FIPS 204 public key — is not something this layer can compute. It
// requires ML-DSA key expansion (rho to the A matrix by rejection sampling, t1,
// and tr = H(pk, 64)), which belongs in the same shared Rust core that will own
// the signature-hint math. Until it exists, both refuse.
const PACKED_KEY_UNAVAILABLE = null;

const ML_DSA_CLASSES: Record<MlDsaKind, MlDsaClassSpec> = {
  // Per-user class: the key is compiled in as constants, storage is empty, and
  // the constructor takes nothing. That makes this the one contract whose
  // address the wallet can already derive, given the generated class hash.
  const: {
    classHashSource: "per-user",
    constructorCalldata: () => [],
    signatureFelts: 905,
  },
  // Shared class, key held in storage and supplied once at deployment.
  storage: {
    classHashSource: "shared",
    constructorCalldata: PACKED_KEY_UNAVAILABLE,
    signatureFelts: 905,
  },
  // Shared class holding only a Poseidon hash of the packed key; the key itself
  // rides in every signature and is authenticated against that hash, so the
  // deployment is cheap and each transaction carries 925 extra felts.
  hashkey: {
    classHashSource: "shared",
    constructorCalldata: PACKED_KEY_UNAVAILABLE,
    signatureFelts: 1830,
  },
};

/**
 * Returns one ML-DSA contract's requirements.
 */
export const mlDsaClassSpec = (kind: MlDsaKind): MlDsaClassSpec => ML_DSA_CLASSES[kind];

// Bytes of the encoded public key packed into one felt. A felt holds a little
// under 2^252, so 31 bytes is the largest chunk that always fits.
const COMMITMENT_BYTES_PER_FELT = 31;

/**
 * A Poseidon commitment over the encoded ML-DSA public key, used as the
 * account's single-felt identity in `publicKeyX`.
 *
 * This is an **identifier**, not calldata. No contract in this family validates
 * against it: `const` binds the key inside its class, `storage` holds the key
 * itself, and `hashkey` commits to the 925-felt *packed* key, which is a
 * different preimage computed elsewhere. What this value does is give a
 * paired-phone account one stable felt for the places the account model needs
 * one — record identity, duplicate detection, and account matching across
 * networks — without pretending a 1952-byte key fits in a felt.
 */
export const mlDsaPublicKeyCommitment = (publicKey: string): string => {
  const digits = publicKey.replace(/^0x/, "");
  const felts: string[] = [];
  for (let index = 0; index < digits.length; index += COMMITMENT_BYTES_PER_FELT * 2) {
    felts.push(`0x${digits.slice(index, index + COMMITMENT_BYTES_PER_FELT * 2)}`);
  }
  return hash.computePoseidonHashOnElements(felts);
};

/**
 * The DEPLOY_ACCOUNT salt for every ML-DSA account. Zero, and single-sourced so
 * the deployment path and the vault's address derivation cannot disagree: with a
 * per-user class there is nothing else distinguishing two accounts of it, and
 * `accountDeployment` refuses any result that does not reproduce the stored
 * address, so a wrong salt fails loudly rather than silently.
 */
export const ML_DSA_ADDRESS_SALT = "0x0";

/**
 * The counterfactual address of an ML-DSA account, or throws `WalletError` when
 * this contract's constructor calldata cannot be derived yet.
 */
export const mlDsaAccountAddress = (
  kind: MlDsaKind,
  classHash: string,
  publicKey: string,
): string =>
  hash.calculateContractAddressFromHash(
    ML_DSA_ADDRESS_SALT,
    classHash,
    [...mlDsaConstructorCalldata(kind, publicKey)],
    0,
  );

/**
 * Constructor calldata for a new account of this contract, or throws
 * `WalletError` naming the contract when deriving it is not yet possible.
 * Refusing is the only safe answer: another contract's preimage produces a
 * plausible address nobody can sign for.
 */
export const mlDsaConstructorCalldata = (kind: MlDsaKind, publicKey: string): readonly string[] => {
  const build = ML_DSA_CLASSES[kind].constructorCalldata;
  if (build === null) {
    // TODO: Blocked
    throw new WalletError(`ML-DSA ${kind} account deployment parameters are not yet defined`);
  }
  return build(publicKey);
};
