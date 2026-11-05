/**
 * Krusty KMS's Quantum Safe Bitcoin (QSB) and Bitcoin calls, split from
 * ./adapter by behaviour: the QSB-HORS-v1 commitments of one vault, a BIP-84
 * P2WPKH keypair, a BIP-322 "simple" proof of that key's address, and
 * SIGHASH_ALL partial signatures on a PSBT.
 *
 * Trust boundary: the adapter's. Every input is checked before Krusty sees it
 * and every result before a caller does, each against its exact shape;
 * anything else throws a `WalletError` naming the rule, never a value. Each
 * Krusty result object is freed as soon as it has been read, which zeroizes
 * Krusty's copy of a private key in WASM memory (the JavaScript string the
 * caller receives cannot be wiped). There is no fallback: a missing export
 * fails the adapter's construction.
 */
import { WalletError } from "@bramble/core/errors";
import { bytesToHex, hexToBytes, isLowercaseHexBytes } from "@bramble/core/hex";
import type { BitcoinP2wpkhKeypair, KmsPort, QsbCommitments } from "@bramble/vault/kms-port";
import { QSB_SECRETS_PER_ROUND, QSB_VAULT_INDEX_LIMIT } from "@bramble/vault/qsb-vault-record";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";
import {
  asRecord,
  freeKrustyResult,
  krustyResultValue,
  requireFunction,
  requireStringField,
} from "./krusty-values";

type BitcoinMethods = Pick<
  KmsPort,
  | "deriveBitcoinP2wpkhKeypair"
  | "deriveQsbCommitments"
  | "signBip322SimpleUnprefixed"
  | "signBitcoinPsbtInputs"
>;

// The Bitcoin mainnet namespace of QSB-HORS-v1, the only one Bramble uses.
const QSB_MAINNET_NAMESPACE = 0;
const QSB_ROOT_TAG = "QSB-HORS-v1/root";
// A commitment is the HASH160 of its secret.
const COMMITMENT_BYTES = 20;
// secp256k1's group order: a private key is in [1, n).
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
// A mainnet P2WPKH address: `bc1q`, a 20-byte program, the bech32 checksum.
const P2WPKH_ADDRESS = /^bc1q[02-9ac-hj-np-z]{38}$/;
const COMPRESSED_PUBLIC_KEY = /^0[23][0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
// The longest message a proof is asked for, and the longest proof the
// coordinator accepts (its `signature` field is at most 4,096 characters).
const MAX_MESSAGE_LENGTH = 4_096;
const MAX_PROOF_LENGTH = 4_096;
// A PSBT handed to Krusty, in bytes. Each input carries its whole previous
// transaction, so this is generous; Bramble's own are far smaller.
const MAX_PSBT_BYTES = 2_000_000;
const MAX_SIGNED_INPUTS = 256;
// What one partial signature may add to a PSBT: key and value headers, the
// 33-byte public key and a DER signature of at most 73 bytes, with room over.
const MAX_BYTES_PER_SIGNATURE = 160;
const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff] as const;
const BIP84_ACCOUNT_PATH = (account: number, change: number, index: number): string =>
  `m/84'/0'/${account}'/${change}/${index}`;

const isIndexBelow = (value: number, limit: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value < limit;

const isPrivateKey = (value: unknown): value is string =>
  isLowercaseHexBytes(value, 32, 32) &&
  BigInt(`0x${value}`) > 0n &&
  BigInt(`0x${value}`) < SECP256K1_ORDER;

const isP2wpkhAddress = (value: unknown): value is string =>
  typeof value === "string" && P2WPKH_ADDRESS.test(value);

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array | null => {
  if (!BASE64.test(text)) {
    return null;
  }
  const binary = atob(text);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));

// One round of 150 commitments, copied out of whatever Krusty returned.
const commitmentRound = (value: unknown, field: string): readonly string[] => {
  const round = krustyResultValue(asRecord(value), field);
  if (
    !Array.isArray(round) ||
    round.length !== QSB_SECRETS_PER_ROUND ||
    !round.every((commitment) =>
      isLowercaseHexBytes(commitment, COMMITMENT_BYTES, COMMITMENT_BYTES),
    )
  ) {
    throw new WalletError(`Krusty KMS returned invalid QSB commitments: ${field}`);
  }
  return Array.from(round as readonly string[]);
};

// R[v] = SHA-256("QSB-HORS-v1/root" || every commitment in round and index
// order), recomputed so a root that does not bind these very commitments is
// refused here rather than recorded in the journal.
const expectedRoot = async (commitments: readonly string[]): Promise<string> => {
  const tag = new TextEncoder().encode(QSB_ROOT_TAG);
  const preimage = new Uint8Array(tag.length + commitments.length * COMMITMENT_BYTES);
  preimage.set(tag);
  commitments.forEach((commitment, index) => {
    preimage.set(hexToBytes(commitment) ?? new Uint8Array(), tag.length + index * COMMITMENT_BYTES);
  });
  return bytesToHex(await sha256(preimage));
};

const readCommitments = async (result: unknown): Promise<QsbCommitments> => {
  const round0 = commitmentRound(result, "round0");
  const round1 = commitmentRound(result, "round1");
  const root = requireStringField(result, "root");
  const all = [...round0, ...round1];
  if (new Set(all).size !== all.length) {
    throw new WalletError("Krusty KMS returned repeated QSB commitments");
  }
  if (!isLowercaseHexBytes(root, 32, 32) || root !== (await expectedRoot(all))) {
    throw new WalletError("Krusty KMS returned a QSB root that does not bind its commitments");
  }
  return { root, round0, round1 };
};

const readKeypair = (result: unknown, path: string): BitcoinP2wpkhKeypair => {
  const address = requireStringField(result, "address");
  const publicKey = requireStringField(result, "public_key");
  const privateKey = requireStringField(result, "private_key");
  if (
    !isP2wpkhAddress(address) ||
    !COMPRESSED_PUBLIC_KEY.test(publicKey) ||
    !isPrivateKey(privateKey) ||
    requireStringField(result, "path") !== path
  ) {
    throw new WalletError("Krusty KMS returned an invalid Bitcoin P2WPKH keypair");
  }
  return { address, privateKey, publicKey };
};

// A pushed witness item: its length byte, then that many bytes.
const witnessItem = (bytes: Uint8Array, offset: number): Uint8Array | null => {
  const length = bytes[offset];
  return length === undefined || offset + 1 + length > bytes.length
    ? null
    : bytes.subarray(offset + 1, offset + 1 + length);
};

// The BIP-322 "simple" witness of a P2WPKH key, exactly: two items, a DER
// signature of 9 to 73 bytes ending in SIGHASH_ALL, then a compressed key.
const isP2wpkhWitness = (bytes: Uint8Array): boolean => {
  if (bytes[0] !== 2) return false;
  const signed = witnessItem(bytes, 1);
  if (!signed || signed.length < 9 || signed.length > 73 || signed.at(-1) !== 0x01) return false;
  const key = witnessItem(bytes, 2 + signed.length);
  return (
    key !== null &&
    key.length === 33 &&
    (key[0] === 2 || key[0] === 3) &&
    3 + signed.length + key.length === bytes.length
  );
};

const isPsbt = (bytes: Uint8Array): boolean =>
  PSBT_MAGIC.every((byte, index) => bytes[index] === byte);

const isInputIndexList = (indices: readonly number[]): boolean =>
  Array.isArray(indices) &&
  indices.length > 0 &&
  indices.length <= MAX_SIGNED_INPUTS &&
  indices.every((index) => isIndexBelow(index, MAX_SIGNED_INPUTS)) &&
  new Set(indices).size === indices.length;

// Reads one Krusty result and always frees it, whether or not it was valid.
const readAndFree = async <T>(result: unknown, read: (result: unknown) => T | Promise<T>) => {
  try {
    return await read(result);
  } finally {
    freeKrustyResult(result);
  }
};

/**
 * The QSB and Bitcoin half of the Krusty port, over the loaded module. Throws
 * at construction when an export is missing; `ready` is the module's init.
 */
export const krustyBitcoinMethods = (
  module: Record<string, unknown>,
  ready: Promise<unknown>,
): BitcoinMethods => {
  const deriveBitcoinP2wpkhKeypair = requireFunction(module, "deriveBitcoinP2wpkhKeypair");
  const deriveQsbCommitments = requireFunction(module, "deriveQsbCommitments");
  const signBip322Simple = requireFunction(module, "signBip322Simple");
  const signBitcoinPsbtInputs = requireFunction(module, "signBitcoinPsbtInputs");

  return {
    async deriveBitcoinP2wpkhKeypair(mnemonic, accountIndex, change, addressIndex) {
      await ready;
      if (
        !isMnemonicText(mnemonic) ||
        !isIndexBelow(accountIndex, 2 ** 31) ||
        !isIndexBelow(change, 2) ||
        !isIndexBelow(addressIndex, 2 ** 31)
      ) {
        throw new WalletError("Invalid Bitcoin derivation input");
      }
      const path = BIP84_ACCOUNT_PATH(accountIndex, change, addressIndex);
      const result = await deriveBitcoinP2wpkhKeypair(mnemonic, accountIndex, change, addressIndex);
      return readAndFree(result, (keypair) => readKeypair(keypair, path));
    },
    async deriveQsbCommitments(mnemonic, vaultIndex) {
      await ready;
      if (!isMnemonicText(mnemonic) || !isIndexBelow(vaultIndex, QSB_VAULT_INDEX_LIMIT)) {
        throw new WalletError("Invalid QSB derivation input");
      }
      const result = await deriveQsbCommitments(mnemonic, QSB_MAINNET_NAMESPACE, vaultIndex);
      return readAndFree(result, readCommitments);
    },
    async signBip322SimpleUnprefixed(privateKey, address, message) {
      await ready;
      if (
        !isPrivateKey(privateKey) ||
        !isP2wpkhAddress(address) ||
        typeof message !== "string" ||
        message.length === 0 ||
        message.length > MAX_MESSAGE_LENGTH
      ) {
        throw new WalletError("Invalid BIP-322 signing input");
      }
      const result = await signBip322Simple(privateKey, address, message, true);
      const witness = typeof result === "string" ? fromBase64(result) : null;
      if (
        typeof result !== "string" ||
        result.length > MAX_PROOF_LENGTH ||
        !witness ||
        !isP2wpkhWitness(witness)
      ) {
        throw new WalletError("Krusty KMS returned an invalid BIP-322 proof");
      }
      return result;
    },
    async signBitcoinPsbtInputs(privateKey, psbt, inputIndices) {
      await ready;
      if (
        !isPrivateKey(privateKey) ||
        !(psbt instanceof Uint8Array) ||
        psbt.length > MAX_PSBT_BYTES ||
        !isPsbt(psbt) ||
        !isInputIndexList(inputIndices)
      ) {
        throw new WalletError("Invalid PSBT signing input");
      }
      const result = await signBitcoinPsbtInputs(privateKey, toBase64(psbt), [...inputIndices]);
      const signed = typeof result === "string" ? fromBase64(result) : null;
      if (
        !signed ||
        !isPsbt(signed) ||
        signed.length > psbt.length + inputIndices.length * MAX_BYTES_PER_SIGNATURE
      ) {
        throw new WalletError("Krusty KMS returned an invalid PSBT");
      }
      return signed;
    },
  };
};
