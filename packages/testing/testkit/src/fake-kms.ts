/**
 * A fake Krusty KMS for wallet service tests: deterministic answers with no real
 * cryptography behind them.
 */

// A stand-in for the real Poseidon commitment over the key's 925-felt packed
// expansion. It is NOT that value and must never be compared to a real one — but
// it is a deterministic function of the whole key, which is the property the
// tests around it depend on: the same key must derive the same account address,
// and two different keys must derive different ones.
const fakeCommitment = (publicKey: string): string => {
  let low = 0n;
  let high = 0n;
  for (const [index, character] of [...publicKey].entries()) {
    const code = BigInt(character.codePointAt(0) ?? 0);
    low = (low * 31n + code) % (1n << 120n);
    high = (high * 17n + code * BigInt(index + 1)) % (1n << 120n);
  }
  return `0x${(low + (high << 120n) + 1n).toString(16)}`;
};

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
      identifier: "mc-wallet.multisig",
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
  async mlDsaKeyCommitment(publicKey: string) {
    return fakeCommitment(publicKey);
  },
  // Accepts only a signature this fake itself would have produced for the same
  // key and hash, so a test that wires the wrong hash or the wrong key still
  // fails. A fake that answered `true` unconditionally would make every
  // fail-closed assertion around it vacuous.
  async mlDsaVerify(publicKey: string, transactionHash: string, signature: string) {
    return signature === `0x${fakeCommitment(`${publicKey}:${transactionHash}`).slice(2)}`;
  },
  async mlDsaSignaturePayload(publicKey: string, transactionHash: string, _signature: string) {
    return Array.from({ length: 1830 }, (_, index) =>
      index === 0 ? fakeCommitment(`${publicKey}:${transactionHash}`) : `0x${index.toString(16)}`,
    );
  },
  async mlDsaEstimationSignature(publicKey: string) {
    return Array.from({ length: 1830 }, (_, index) =>
      index === 0 ? fakeCommitment(publicKey) : `0x${index.toString(16)}`,
    );
  },
});
