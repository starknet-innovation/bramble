/**
 * Adapter boundary for the STRK20 viewing-key stages and the account-address salt.
 *
 * Split from ./adapter.test.ts because these exercise a different contract: the
 * two-stage Ledger ceremony and the pinned salt, both of which are validated at
 * the WASM boundary rather than by the signing/derivation paths next door.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@mc-wallet/kms-krusty/adapter";

const createModule = (signatureR = "0x1") => ({
  deriveNostrPublicKey() {
    return { public_key: "11".repeat(32) };
  },
  deriveOzAccountAddress() {
    return "0xabc";
  },
  deriveScopedStrk20ViewingKey() {
    return "0x456";
  },
  foldStrk20ViewingKey() {
    return "0x789";
  },
  strk20ViewingKeyMessageHash() {
    return "0xabc";
  },
  deriveStarknetKeypair() {
    return {
      private_key: "0x123",
      public_key_x: "0xabc",
      public_key_y: "0xdef",
    };
  },
  generateMnemonic() {
    return "habit hope tip crystal because grunt nation idea electric witness alert like";
  },
  getAccountClassHashes() {
    return "{}";
  },
  openNostrApplicationData() {
    return JSON.stringify({
      content: "payload",
      identifier: "mc-wallet.multisig",
      senderPublicKey: "22".repeat(32),
    });
  },
  signStarkHash() {
    return {
      publicKey: "0xabc",
      r: signatureR,
      s: "0x2",
    };
  },
  validateMnemonic() {
    return true;
  },
  wrapNostrApplicationData() {
    return JSON.stringify({
      content: "ciphertext",
      created_at: 1,
      id: "11".repeat(32),
      kind: 1_059,
      pubkey: "22".repeat(32),
      sig: "33".repeat(64),
      tags: [["p", "44".repeat(32)]],
    });
  },
});

describe("Krusty KMS adapter — STRK20 viewing keys", () => {
  test("validates the two viewing-key ceremony stages at the boundary", async () => {
    const kms = createKrustyKms(createModule());

    await expect(kms.strk20ViewingKeyMessageHash("0x1", "0x2")).resolves.toBe("0xabc");
    await expect(kms.foldStrk20ViewingKey("0x9", "0x1", "0x1", "0x2")).resolves.toBe("0x789");

    // The scope must be canonical: two spellings of one pool would otherwise
    // derive two different keys, and a registered key cannot be changed.
    await expect(kms.strk20ViewingKeyMessageHash("0x01", "0x2")).rejects.toThrow(
      "Invalid STRK20 viewing-key scope",
    );
    await expect(kms.strk20ViewingKeyMessageHash("0x1", "0x02")).rejects.toThrow(
      "Invalid STRK20 viewing-key scope",
    );
    await expect(kms.strk20ViewingKeyMessageHash("0x0", "0x2")).rejects.toThrow(
      "Invalid STRK20 viewing-key scope",
    );
    // (r, s) come from a device the wallet does not control.
    await expect(kms.foldStrk20ViewingKey("0x9", "0x1", "nope", "0x2")).rejects.toThrow(
      "Invalid STRK20 viewing-key signature input",
    );
  });

  test("pins the account-address salt to 0 instead of the KMS default", async () => {
    // A deployed account's address is immutable, so the salt that produced it is
    // a wallet invariant. Upstream 0.6.0 changed its own default from 0 to the
    // public key with no signature change, which re-derived every account to an
    // address that had never been deployed; the adapter must therefore always say
    // which salt it means, and pass a caller's through untouched.
    const seen: unknown[][] = [];
    const kms = createKrustyKms({
      ...createModule(),
      deriveOzAccountAddress(...args: unknown[]) {
        seen.push(args);
        return "0xabc";
      },
    });

    await expect(kms.deriveOzAccountAddress("0x1", "0x2")).resolves.toBe("0xabc");
    await expect(kms.deriveOzAccountAddress("0x1", "0x2", "0x9")).resolves.toBe("0xabc");
    expect(seen).toEqual([
      ["0x1", "0x2", "0x0"],
      ["0x1", "0x2", "0x9"],
    ]);
  });

  test("binds the scoped derivation and refuses a build offering only the unscoped one", async () => {
    // The KMS exports both `deriveStrk20ViewingKey` (private key only) and
    // `deriveScopedStrk20ViewingKey` (private key + chain + pool). Extra
    // arguments are silently dropped in JS, so binding the wrong one would derive
    // an unscoped key the pool does not recognize — with nothing throwing. The
    // adapter must therefore fail closed on a module that lacks the scoped
    // export, rather than falling back to the unscoped one that happens to exist.
    const { deriveScopedStrk20ViewingKey: _omitted, ...unscopedOnly } = {
      ...createModule(),
      deriveStrk20ViewingKey() {
        return "0xunscoped";
      },
    };

    expect(() => createKrustyKms(unscopedOnly)).toThrow(
      "Krusty KMS export missing: deriveScopedStrk20ViewingKey",
    );
  });

  test("passes the signature's subject through to the fold", async () => {
    // The fold verifies (r, s) against the public key and message hash, so the
    // adapter must hand all four through in order. A dropped or reordered
    // argument would make every device signature unverifiable.
    const seen: unknown[][] = [];
    const kms = createKrustyKms({
      ...createModule(),
      foldStrk20ViewingKey(...args: unknown[]) {
        seen.push(args);
        return "0x789";
      },
    });

    await expect(kms.foldStrk20ViewingKey("0x9", "0xa", "0x1", "0x2")).resolves.toBe("0x789");
    expect(seen).toEqual([["0x9", "0xa", "0x1", "0x2"]]);
  });

  test("rejects ceremony output the wallet cannot use as a viewing key", async () => {
    // A fold result outside [1, n/2] means the WASM build broke its own range
    // guarantee; registering it would strand the account's notes.
    const outOfRange = createKrustyKms({
      ...createModule(),
      foldStrk20ViewingKey() {
        return "0x0";
      },
    });
    await expect(outOfRange.foldStrk20ViewingKey("0x9", "0x1", "0x1", "0x2")).rejects.toThrow(
      "Krusty KMS returned an invalid STRK20 viewing key",
    );

    const badHash = createKrustyKms({
      ...createModule(),
      strk20ViewingKeyMessageHash() {
        return "not-a-felt";
      },
    });
    await expect(badHash.strk20ViewingKeyMessageHash("0x1", "0x2")).rejects.toThrow(
      "Krusty KMS returned an invalid STRK20 message hash",
    );
  });
});
