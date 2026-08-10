/**
 * Minimal fake Krusty KMS for wallet service tests.
 */
import type { KrustyKms, StarkKeypair, StarkSignature } from "../../src/crypto/krusty";

export const fakeKms = (validMnemonic = true): KrustyKms => ({
  async deriveOzAccountAddress(publicKeyX, classHash) {
    return `0x${publicKeyX.slice(2)}${classHash.slice(2, 8)}`;
  },
  async deriveStrk20ViewingKey() {
    return "0x654321";
  },
  // The two ceremony stages model the real ones' load-bearing properties without
  // any crypto: the message hash is scope-dependent (so a test can prove the
  // device was asked to sign the right scope) and the fold is a pure function of
  // (r, s) (so a test can prove the stored key came from the device signature).
  // Both return canonical non-zero felts well inside the curve order, because the
  // ceremony validates them exactly as it validates real Krusty output.
  async foldStrk20ViewingKey(r, s) {
    const folded = (BigInt(r) * 0x10001n + BigInt(s)) % 0xffff_ffff_ffff_ffffn;
    return `0x${(folded === 0n ? 1n : folded).toString(16)}`;
  },
  async strk20ViewingKeyMessageHash(chainId, poolAddress) {
    const hash = (BigInt(chainId) * 0x1_0000_0001n + BigInt(poolAddress)) % (1n << 200n);
    return `0x${(hash === 0n ? 1n : hash).toString(16)}`;
  },
  async deriveStarknetKeypair(): Promise<StarkKeypair> {
    return {
      privateKey: "0x123456",
      publicKeyX: "0xabc",
      publicKeyY: "0xdef",
    };
  },
  async generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  async getAccountClassHashes() {
    return JSON.stringify({
      oz: {
        "3.0.0": {
          SN_MAIN: "0x111111",
          SN_SEPOLIA: "0xabcdef",
        },
      },
    });
  },
  async signStarkHash(): Promise<StarkSignature> {
    return {
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    };
  },
  async validateMnemonic() {
    return validMnemonic;
  },
});
