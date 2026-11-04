/**
 * A deterministic stand-in for Krusty KMS in wallet tests. Never a production
 * dependency; every phrase and key here is public.
 */
import { createHash } from "node:crypto";

// The 12-word phrase the fake generates by default (and for any count but 24).
const FAKE_GENERATED_MNEMONIC =
  "habit hope tip crystal because grunt nation idea electric witness alert like";

/**
 * The 24-word phrase the fake generates when asked for 24 words, as a QSB
 * account is: a published BIP-39 test vector (entropy 0x68a79eac…6ce7c),
 * public and never for funds, deliberately distinct from the 12-word one so a
 * test can tell which count was requested.
 */
export const FAKE_GENERATED_MNEMONIC_24 =
  "hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length";

/**
 * The BIP-84 test vector the fake's Bitcoin key always is: `m/84'/0'/0'/0/0`
 * of the published `abandon … about` phrase, as BIP-84 lists it. Public, and
 * never for funds.
 */
export const FAKE_BITCOIN_OWNER = {
  address: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
  privateKey: "4604b4b710fe91f584fff084e1a9159fe4f8408fff380596a604948474ce4fa3",
  publicKey: "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
} as const;

const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

// Real-shaped commitments: 2 × 150 distinct 20-byte values per phrase and
// vault, with the root QSB-HORS-v1 defines over them, so a consumer that
// checks the root against the commitments accepts what the fake returns.
const fakeQsbCommitments = (mnemonic: string, vaultIndex: number) => {
  const round = (r: number): string[] =>
    Array.from({ length: 150 }, (_, index) =>
      sha256Hex(`fake qsb ${mnemonic} ${vaultIndex} ${r} ${index}`).slice(0, 40),
    );
  const round0 = round(0);
  const round1 = round(1);
  const root = sha256Hex(
    Buffer.concat([
      Buffer.from("QSB-HORS-v1/root"),
      ...[...round0, ...round1].map((commitment) => Buffer.from(commitment, "hex")),
    ]),
  );
  return { root, round0, round1 };
};

/**
 * Minimal fake Krusty KMS for wallet service tests. Its Bitcoin calls are
 * deterministic and real-shaped but never sign: the BIP-322 proof is a fixed
 * well-formed witness and a PSBT comes back unchanged, so a flow that verifies
 * what was signed refuses the fake's output. Suites that need a real
 * signature use the real Krusty adapter.
 */
export const fakeKms = (validMnemonic = true) => ({
  async deriveBitcoinP2wpkhKeypair(
    _mnemonic: string,
    _accountIndex: number,
    _change: number,
    _addressIndex: number,
  ) {
    return { ...FAKE_BITCOIN_OWNER };
  },
  async deriveQsbCommitments(mnemonic: string, vaultIndex: number) {
    return fakeQsbCommitments(mnemonic, vaultIndex);
  },
  async signBip322SimpleUnprefixed(_privateKey: string, _address: string, message: string) {
    // [a 71-byte DER-shaped item ending in SIGHASH_ALL, the owner's key].
    const body = Buffer.from(sha256Hex(message).repeat(3).slice(0, 140), "hex");
    const signed = Buffer.concat([Buffer.from([0x30]), body, Buffer.from([0x01])]);
    return Buffer.concat([
      Buffer.from([2, signed.length]),
      signed,
      Buffer.from([33]),
      Buffer.from(FAKE_BITCOIN_OWNER.publicKey, "hex"),
    ]).toString("base64");
  },
  async signBitcoinPsbtInputs(
    _privateKey: string,
    psbt: Uint8Array,
    _inputIndices: readonly number[],
  ) {
    return Uint8Array.from(psbt);
  },
  async deriveNostrPublicKey(
    _mnemonic: string,
    _addressIndex: number,
    _accountIndex: number,
    _passphrase?: string,
  ) {
    return "11".repeat(32);
  },
  async deriveOzAccountAddress(publicKeyX: string, classHash: string, _salt?: string) {
    return `0x${publicKeyX.slice(2)}${classHash.slice(2, 8)}`;
  },
  async deriveStrk20ViewingKey(_privateKey: string, _chainId: string, _poolAddress: string) {
    return "0x654321";
  },
  async deriveArgentLegacyKeypair(_mnemonic: string, addressIndex: number) {
    // Distinct from the plain ladder's keys so a test can tell the schemes
    // apart, and distinct per index so coordinates never collide.
    return {
      privateKey: `0x9${addressIndex.toString(16)}123456`,
      publicKeyX: `0xa9${addressIndex.toString(16)}bc`,
    };
  },
  async deriveStarknetKeypair(
    _mnemonic: string,
    _addressIndex: number,
    _accountIndex: number,
    _passphrase?: string,
  ) {
    return {
      privateKey: "0x123456",
      publicKeyX: "0xabc",
      publicKeyY: "0xdef",
    };
  },
  // Deterministic, and honours the one other count the wallet asks for.
  async generateMnemonic(wordCount?: number) {
    return wordCount === 24 ? FAKE_GENERATED_MNEMONIC_24 : FAKE_GENERATED_MNEMONIC;
  },
  async openNostrApplicationData(
    _mnemonic: string,
    _addressIndex: number,
    _accountIndex: number,
    eventJson: string,
    _passphrase?: string,
  ) {
    const event = JSON.parse(eventJson) as { readonly content: string };
    return {
      content: event.content,
      identifier: "bramble.multisig",
      senderPublicKey: "22".repeat(32),
    };
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
  async signStarkHash(_privateKey: string, _messageHash: string) {
    return {
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    };
  },
  async validateMnemonic(_mnemonic: string) {
    return validMnemonic;
  },
  async wrapNostrApplicationData(
    _mnemonic: string,
    _addressIndex: number,
    _accountIndex: number,
    recipientPublicKey: string,
    _identifier: string,
    content: string,
    _passphrase?: string,
  ) {
    return JSON.stringify({
      content,
      created_at: 1,
      id: "11".repeat(32),
      kind: 1_059,
      pubkey: "22".repeat(32),
      sig: "33".repeat(64),
      tags: [["p", recipientPublicKey]],
    });
  },
});
