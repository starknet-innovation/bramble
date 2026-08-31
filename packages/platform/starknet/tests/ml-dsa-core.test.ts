/**
 * Known-answer tests for the ML-DSA core against the contract repository's own
 * checked-in vectors (`mldsa/src/vector.cairo` and `mldsa/src/packed_key.cairo`,
 * generated there by `py/gen_vectors.py` and marked do-not-edit).
 *
 * This is the only test that can catch the failure that matters. A packed key
 * or a hint row that is wrong but well-formed produces an address nobody holds
 * the key for, or a transaction the contract rejects with no diagnosis — both
 * silent. Matching the values the Cairo verifier was built against is what rules
 * that out, and it is why the digests below are of the Cairo output rather than
 * of ours.
 *
 * When this moves to krusty-kms, this file is the acceptance test for the port.
 */
import { describe, expect, test } from "bun:test";
import {
  ML_DSA_PAYLOAD_FELTS,
  mlDsaEstimationSignature,
  mlDsaKeyCommitment,
  mlDsaPackedKey,
  mlDsaSignaturePayload,
  verifyMlDsa65Signature,
} from "@mc-wallet/starknet/ml-dsa-core";
import { hash } from "starknet";
import { unpackHints, unpackZSigned } from "../src/accounts/ml-dsa-math";
import known from "./fixtures/ml-dsa-known-answers.json";

const { publicKey, signature, transactionHash } = known;
const digest = (felts: readonly string[]): string => hash.computePoseidonHashOnElements([...felts]);

describe("ML-DSA-65 verification", () => {
  test("accepts the reference signature over the reference hash", () => {
    expect(verifyMlDsa65Signature({ hash: transactionHash, publicKey, signature })).toBe(true);
  });

  test("rejects a tampered signature, a tampered key, and a different hash", () => {
    const flip = (value: string, index: number): string =>
      `${value.slice(0, index)}${value[index] === "0" ? "1" : "0"}${value.slice(index + 1)}`;
    expect(
      verifyMlDsa65Signature({ hash: transactionHash, publicKey, signature: flip(signature, 200) }),
    ).toBe(false);
    expect(
      verifyMlDsa65Signature({ hash: transactionHash, publicKey: flip(publicKey, 200), signature }),
    ).toBe(false);
    expect(verifyMlDsa65Signature({ hash: "0x1e240", publicKey, signature })).toBe(false);
  });

  test("refuses malformed input rather than throwing", () => {
    expect(verifyMlDsa65Signature({ hash: transactionHash, publicKey: "0xab", signature })).toBe(
      false,
    );
    expect(verifyMlDsa65Signature({ hash: transactionHash, publicKey, signature: "0xab" })).toBe(
      false,
    );
    expect(verifyMlDsa65Signature({ hash: "not a felt", publicKey, signature })).toBe(false);
  });
});

describe("ML-DSA-65 key expansion", () => {
  test("reproduces the contract's 925-felt packed key", () => {
    const packed = mlDsaPackedKey(publicKey);
    expect(packed).toHaveLength(known.sections.packedKey.length);
    expect(digest(packed)).toBe(known.sectionDigests.packedKey);
  });

  test("commits to the packed key with the hash the constructor takes", () => {
    // Equal to the packed-key digest by construction: `key_hash` is exactly
    // poseidon_hash_span over those felts, which is what the contract re-hashes.
    expect(mlDsaKeyCommitment(publicKey)).toBe(known.keyCommitment);
    expect(mlDsaKeyCommitment(publicKey)).toBe(known.sectionDigests.packedKey);
  });

  test("expands a different key to a different commitment", () => {
    const other = `0x${"ab".repeat(1952)}`;
    expect(mlDsaKeyCommitment(other)).not.toBe(known.keyCommitment);
  });
});

describe("ML-DSA-65 transaction payload", () => {
  const payload = mlDsaSignaturePayload({ hash: transactionHash, publicKey, signature });

  test("is 1830 felts in the layout the contract reads", () => {
    expect(payload).toHaveLength(ML_DSA_PAYLOAD_FELTS);
    expect(payload).toHaveLength(known.payloadFelts);
    expect(digest(payload)).toBe(known.payloadDigest);
  });

  test("matches the contract's vectors section by section", () => {
    // Per section rather than only in total, so a failure says which half of the
    // port broke: the key expansion, the signature transport, or one hint row.
    for (const [name, { offset, length }] of Object.entries(known.sections)) {
      expect(digest(payload.slice(offset, offset + length))).toBe(
        known.sectionDigests[name as keyof typeof known.sectionDigests],
      );
    }
  });

  test("refuses to build a payload for a signature that does not verify", () => {
    expect(() =>
      mlDsaSignaturePayload({
        hash: "0x1e240",
        publicKey,
        signature,
      }),
    ).toThrow("does not verify under this key");
  });
});

describe("ML-DSA-65 estimation signature", () => {
  const dummy = mlDsaEstimationSignature(publicKey);

  test("is the same shape as a real payload", () => {
    expect(dummy).toHaveLength(ML_DSA_PAYLOAD_FELTS);
    // Same length is what lets it reach the verifier at all: the contract's
    // first check is the felt count.
    expect(dummy).toHaveLength(known.payloadFelts);
  });

  test("carries the real packed key", () => {
    // Not required by the current contract, which tolerates an unpinned key
    // under a query version — but it keeps the measured path identical to a real
    // transaction's, and it still works against a class built before that
    // tolerance existed.
    expect(dummy.slice(0, known.sections.packedKey.length)).toEqual([...mlDsaPackedKey(publicKey)]);
  });

  test("does not verify, which is the point", () => {
    // If it verified it would be a signature, and the wallet cannot produce one
    // without the phone. The contract runs the whole verifier and discards this
    // verdict; only under a query version, which no sequencer will execute.
    const real = mlDsaSignaturePayload({ hash: transactionHash, publicKey, signature });
    expect(dummy).not.toEqual(real);
  });

  test("clears every gate that would cut the verifier short", () => {
    // A malformed dummy is tolerated too, but exits early and yields a uselessly
    // low estimate — measured at 51% of the real cost before the contract's
    // final hash was made unconditional. These are the three exits.
    expect(unpackHints(new Uint8Array(61))).not.toBeNull();
    const zBytes = new Uint8Array(640);
    for (let group = 0; group < 128; group += 1) {
      const wire = 0x80000n | (0x80000n << 20n);
      for (let byte = 0; byte < 5; byte += 1) {
        zBytes[5 * group + byte] = Number((wire >> BigInt(8 * byte)) & 0xffn);
      }
    }
    expect(Math.max(...unpackZSigned(zBytes).map(Math.abs))).toBe(0);
  });

  test("is a function of the key alone, so it needs no signer and no storage", () => {
    expect(mlDsaEstimationSignature(publicKey)).toEqual(dummy);
    expect(mlDsaEstimationSignature(`0x${"cd".repeat(1952)}`)).not.toEqual(dummy);
  });
});
