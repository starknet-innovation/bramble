/**
 * Host-side Ledger signature-verification gate: it must accept a genuine device
 * signature and fail closed on a tampered signature, wrong key, wrong hash, or
 * malformed input — this is the last check before a transaction is broadcast.
 */
import { describe, expect, test } from "bun:test";
import { ec } from "starknet";
import { type DeviceSignature, verifyStarkSignature } from "../../src/starknet/ledger-verify";

const { starkCurve } = ec;

// A fixed key + hash so the vectors are deterministic. The "device" here is
// starknet.js signing with the private key; production replaces it with a Ledger.
const PRIVATE_KEY = "0x1234567890abcdef";
const HASH = "0x1e240"; // 123456
const publicKeyX = starkCurve.getStarkKey(PRIVATE_KEY);

const sign = (hash: string): DeviceSignature => {
  const sig = starkCurve.sign(hash, PRIVATE_KEY);
  return { r: `0x${sig.r.toString(16)}`, s: `0x${sig.s.toString(16)}` };
};

describe("verifyStarkSignature", () => {
  test("accepts a genuine signature of the hash under the account key", () => {
    expect(verifyStarkSignature({ hash: HASH, publicKeyX, signature: sign(HASH) })).toBe(true);
  });

  test("rejects a signature of a different hash (substituted payload)", () => {
    expect(verifyStarkSignature({ hash: "0x1e241", publicKeyX, signature: sign(HASH) })).toBe(
      false,
    );
  });

  test("rejects a signature under a different account key (wrong device)", () => {
    const otherX = starkCurve.getStarkKey("0xdeadbeef");
    expect(verifyStarkSignature({ hash: HASH, publicKeyX: otherX, signature: sign(HASH) })).toBe(
      false,
    );
  });

  test("rejects a tampered (r, s)", () => {
    const good = sign(HASH);
    const tampered = { r: good.r, s: `0x${(BigInt(good.s) ^ 1n).toString(16)}` };
    expect(verifyStarkSignature({ hash: HASH, publicKeyX, signature: tampered })).toBe(false);
  });

  test("fails closed on malformed inputs rather than throwing", () => {
    const good = sign(HASH);
    expect(verifyStarkSignature({ hash: "not-hex", publicKeyX, signature: good })).toBe(false);
    expect(verifyStarkSignature({ hash: HASH, publicKeyX: "0xzz", signature: good })).toBe(false);
    expect(
      verifyStarkSignature({ hash: HASH, publicKeyX, signature: { r: "oops", s: good.s } }),
    ).toBe(false);
    expect(
      verifyStarkSignature({ hash: HASH, publicKeyX, signature: { r: good.r, s: "0x0" } }),
    ).toBe(false);
  });
});
