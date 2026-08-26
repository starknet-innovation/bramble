/**
 * The verify-before-broadcast gate for a paired device. A signature that passes
 * here is about to be put on chain, so these tests use real ML-DSA-65 keys and
 * cover the ways a wrong one could slip through: another key, another hash, a
 * mutated signature, a non-empty context, and a hash spelled differently from
 * the 32 bytes actually signed.
 *
 * The message encoding here is written out independently rather than reusing the
 * verifier's own `paddedFelt`/`hexToBytes` path. That is deliberate: a test that
 * encodes through the implementation cannot catch the implementation encoding
 * the wrong bytes.
 */
import { describe, expect, test } from "bun:test";
import { verifyMlDsa65Signature } from "@mc-wallet/starknet/ml-dsa-verify";
import {
  ML_DSA_65_PUBLIC_KEY_BYTES,
  ML_DSA_65_SIGNATURE_BYTES,
} from "@mc-wallet/wallet-model/signing";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

const HASH = "0x1e240";
const FELT_BYTES = 32;

const hex = (bytes: Uint8Array): string =>
  `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

// 32 big-endian bytes of the hash, per the wire contract.
const messageOf = (hash: string): Uint8Array =>
  Uint8Array.from(
    (
      BigInt(hash)
        .toString(16)
        .padStart(FELT_BYTES * 2, "0")
        .match(/../g) as string[]
    ).map((pair) => Number.parseInt(pair, 16)),
  );

const enrolled = ml_dsa65.keygen(new Uint8Array(32).fill(7));
const impostor = ml_dsa65.keygen(new Uint8Array(32).fill(9));
const publicKey = hex(enrolled.publicKey);

const sign = (hash: string, secretKey: Uint8Array = enrolled.secretKey, context?: Uint8Array) =>
  hex(ml_dsa65.sign(messageOf(hash), secretKey, context ? { context } : undefined));

describe("verifyMlDsa65Signature", () => {
  test("the parameter set the account model assumes is the one the library uses", () => {
    expect(enrolled.publicKey.length).toBe(ML_DSA_65_PUBLIC_KEY_BYTES);
    expect(ml_dsa65.sign(messageOf(HASH), enrolled.secretKey).length).toBe(
      ML_DSA_65_SIGNATURE_BYTES,
    );
  });

  test("accepts a real signature over the transaction hash", () => {
    expect(verifyMlDsa65Signature({ hash: HASH, publicKey, signature: sign(HASH) })).toBe(true);
  });

  test("fails closed when the device signed for another key or another hash", () => {
    expect(
      verifyMlDsa65Signature({ hash: HASH, publicKey, signature: sign(HASH, impostor.secretKey) }),
    ).toBe(false);
    expect(
      verifyMlDsa65Signature({
        hash: HASH,
        publicKey: hex(impostor.publicKey),
        signature: sign(HASH),
      }),
    ).toBe(false);
    expect(verifyMlDsa65Signature({ hash: "0x1e241", publicKey, signature: sign(HASH) })).toBe(
      false,
    );
  });

  test("fails closed on a mutated signature", () => {
    const good = sign(HASH);
    const flipped = `${good.slice(0, -1)}${good.at(-1) === "0" ? "1" : "0"}`;
    expect(verifyMlDsa65Signature({ hash: HASH, publicKey, signature: flipped })).toBe(false);
  });

  test("the empty context is load-bearing: a domain-separated signature is refused", () => {
    const contextual = sign(HASH, enrolled.secretKey, Uint8Array.from([1]));
    expect(verifyMlDsa65Signature({ hash: HASH, publicKey, signature: contextual })).toBe(false);
  });

  test("the signed message is the value, not its spelling", () => {
    // A leading-zero spelling is the same 32 bytes and must still verify; a
    // different value must not, even one differing only by trailing zeroes.
    expect(verifyMlDsa65Signature({ hash: "0x01e240", publicKey, signature: sign(HASH) })).toBe(
      true,
    );
    expect(verifyMlDsa65Signature({ hash: HASH, publicKey, signature: sign("0x1e2400") })).toBe(
      false,
    );
  });

  test("malformed inputs are refused without throwing", () => {
    const good = sign(HASH);
    expect(verifyMlDsa65Signature({ hash: "not-hex", publicKey, signature: good })).toBe(false);
    expect(verifyMlDsa65Signature({ hash: HASH, publicKey: "0x456", signature: good })).toBe(false);
    expect(verifyMlDsa65Signature({ hash: HASH, publicKey, signature: "0xab" })).toBe(false);
    expect(
      verifyMlDsa65Signature({ hash: HASH, publicKey: publicKey.toUpperCase(), signature: good }),
    ).toBe(false);
  });
});
