/**
 * Krusty KMS's QSB disclosure calls, split from ./bitcoin by behaviour: the
 * disclosure digest of a withdrawal transaction `T` and the release of the 15
 * HORS preimages one disclosure names ("QSB Wallet Secret Management" BIP,
 * profile QSB-HORS-v1, "Disclosure requests and retries").
 *
 * Trust boundary: the adapter's. `T` must parse as the BIP's empty-scriptSig,
 * witness-free legacy serialization before Krusty sees it, and the indices
 * must be exactly 8 and 7 distinct values below 150, passed in the order given
 * — never sorted. Krusty's digest is accepted only if it equals the digest
 * recomputed here with WebCrypto from the same bytes, so a wrong `B` or `D`
 * can never be recorded; its preimages only as exactly 15 lowercase 20-byte
 * hex strings. Failures throw a `WalletError` naming the rule, never a value.
 *
 * The reveal hands out spending secrets. Nothing here checks that the
 * disclosure is durably recorded: the vault service's one release method does
 * that in the same queue slot, before calling it, and no other code may.
 * Krusty wipes its own copies; the JavaScript strings returned cannot be.
 */
import { WalletError } from "@bramble/core/errors";
import { bytesToHex, hexToBytes, isLowercaseHexBytes } from "@bramble/core/hex";
import type { KmsPort, QsbRevealDigest } from "@bramble/vault/kms-port";
import { qsbTransactionOutpoints } from "@bramble/vault/qsb-transaction";
import {
  QSB_DISCLOSURE_COUNTS,
  QSB_MAX_TRANSACTION_BYTES,
  QSB_SECRETS_PER_ROUND,
  QSB_VAULT_INDEX_LIMIT,
} from "@bramble/vault/qsb-vault-record";
import { isMnemonicText } from "@bramble/wallet-model/passphrase";
import { freeKrustyResult, requireFunction, requireStringField } from "./krusty-values";

type RevealMethods = Pick<KmsPort, "qsbRevealDigest" | "revealQsbPreimages">;

// The Bitcoin mainnet namespace of QSB-HORS-v1, the only one Bramble uses.
const QSB_MAINNET_NAMESPACE = 0;
const QSB_REVEAL_TAG = "QSB-HORS-v1/reveal";
const PREIMAGE_BYTES = 20;
const DISCLOSED = QSB_DISCLOSURE_COUNTS.round0 + QSB_DISCLOSURE_COUNTS.round1;

// Exactly `count` distinct indices below 150, as a plain array.
const isRound = (value: unknown, count: number): value is readonly number[] =>
  Array.isArray(value) &&
  value.length === count &&
  value.every(
    (index) =>
      typeof index === "number" &&
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < QSB_SECRETS_PER_ROUND,
  ) &&
  new Set(value).size === count;

const isRounds = (round0: unknown, round1: unknown): boolean =>
  isRound(round0, QSB_DISCLOSURE_COUNTS.round0) && isRound(round1, QSB_DISCLOSURE_COUNTS.round1);

// The BIP's T: one legacy transaction, every scriptSig empty, no witness.
const isTransaction = (value: unknown): value is string =>
  isLowercaseHexBytes(value, 1, QSB_MAX_TRANSACTION_BYTES) &&
  qsbTransactionOutpoints(value) !== null;

const sha256 = async (bytes: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));

/**
 * `B = SHA256(T)` and `D = SHA256("QSB-HORS-v1/reveal" || I || B)`, where `I`
 * is every index as a big-endian u16, round 0's then round 1's, in order.
 */
const expectedDigest = async (
  transaction: string,
  round0: readonly number[],
  round1: readonly number[],
): Promise<QsbRevealDigest> => {
  const binding = await sha256(hexToBytes(transaction) ?? new Uint8Array());
  const tag = new TextEncoder().encode(QSB_REVEAL_TAG);
  const indices = [...round0, ...round1];
  const message = new Uint8Array(tag.length + indices.length * 2 + binding.length);
  message.set(tag);
  indices.forEach((index, at) => {
    message[tag.length + at * 2] = index >> 8;
    message[tag.length + at * 2 + 1] = index & 0xff;
  });
  message.set(binding, tag.length + indices.length * 2);
  return { binding: bytesToHex(binding), digest: bytesToHex(await sha256(message)) };
};

const readDigest = async (result: unknown, expected: QsbRevealDigest): Promise<QsbRevealDigest> => {
  try {
    const binding = requireStringField(result, "binding");
    const digest = requireStringField(result, "digest");
    if (binding !== expected.binding || digest !== expected.digest) {
      throw new WalletError("Krusty KMS returned a QSB disclosure digest that does not bind T");
    }
    return { binding, digest };
  } finally {
    freeKrustyResult(result);
  }
};

const readPreimages = (result: unknown): readonly string[] => {
  if (
    !Array.isArray(result) ||
    result.length !== DISCLOSED ||
    !result.every((preimage) => isLowercaseHexBytes(preimage, PREIMAGE_BYTES, PREIMAGE_BYTES))
  ) {
    throw new WalletError("Krusty KMS returned invalid QSB preimages");
  }
  return Array.from(result as readonly string[]);
};

/**
 * The QSB disclosure half of the Krusty port, over the loaded module. Throws
 * at construction when an export is missing; `ready` is the module's init.
 */
export const krustyQsbRevealMethods = (
  module: Record<string, unknown>,
  ready: Promise<unknown>,
): RevealMethods => {
  const qsbRevealDigest = requireFunction(module, "qsbRevealDigest");
  const revealQsbPreimages = requireFunction(module, "revealQsbPreimages");

  return {
    async qsbRevealDigest(transaction, round0, round1) {
      await ready;
      if (!isTransaction(transaction) || !isRounds(round0, round1)) {
        throw new WalletError("Invalid QSB disclosure digest input");
      }
      const expected = await expectedDigest(transaction, round0, round1);
      return readDigest(await qsbRevealDigest(transaction, [...round0], [...round1]), expected);
    },
    async revealQsbPreimages(mnemonic, vaultIndex, round0, round1) {
      await ready;
      if (
        !isMnemonicText(mnemonic) ||
        !Number.isSafeInteger(vaultIndex) ||
        vaultIndex < 0 ||
        vaultIndex >= QSB_VAULT_INDEX_LIMIT ||
        !isRounds(round0, round1)
      ) {
        throw new WalletError("Invalid QSB disclosure input");
      }
      return readPreimages(
        await revealQsbPreimages(
          mnemonic,
          QSB_MAINNET_NAMESPACE,
          vaultIndex,
          [...round0],
          [...round1],
        ),
      );
    },
  };
};
