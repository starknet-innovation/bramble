/**
 * A deterministic stand-in for Krusty KMS in wallet tests. Never a production
 * dependency; every phrase here is public.
 */

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
 * Minimal fake Krusty KMS for wallet service tests.
 */
export const fakeKms = (validMnemonic = true) => ({
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
