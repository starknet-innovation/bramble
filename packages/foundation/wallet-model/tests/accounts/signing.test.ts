/**
 * The account signature seam is a discriminated union, so a submitting path
 * whose account contract only validates `(r, s)` must fail closed rather than
 * serialize a scheme it cannot express. These tests pin that narrowing.
 */
import { expect, test } from "bun:test";
import {
  type AccountSignature,
  type MlDsa65Signature,
  requireStarkSignature,
} from "@mc-wallet/wallet-model/signing";

const STARK: AccountSignature = { kind: "stark", publicKey: "0xabc", r: "0x1", s: "0x2" };

const ML_DSA: MlDsa65Signature = {
  kind: "ml-dsa-65",
  publicKey: `0x${"ab".repeat(1952)}`,
  signature: `0x${"cd".repeat(3309)}`,
};

test("returns the bare Stark signature without the scheme tag", () => {
  expect(requireStarkSignature(STARK)).toEqual({ publicKey: "0xabc", r: "0x1", s: "0x2" });
});

test("fails closed on a post-quantum signature instead of dropping fields", () => {
  expect(() => requireStarkSignature(ML_DSA)).toThrow("Unsupported signature scheme: ml-dsa-65");
});
