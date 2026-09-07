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
  async generateMnemonic(_wordCount?: number) {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
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
