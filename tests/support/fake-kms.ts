/**
 * Minimal fake Krusty KMS for wallet service tests.
 */
import type { KrustyKms, StarkKeypair, StarkSignature } from "../../src/crypto/krusty";

export const fakeKms = (validMnemonic = true): KrustyKms => ({
  async deriveOzAccountAddress(publicKeyX, classHash) {
    return `0x${publicKeyX.slice(2)}${classHash.slice(2, 8)}`;
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
