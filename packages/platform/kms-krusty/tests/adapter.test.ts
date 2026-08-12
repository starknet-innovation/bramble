/**
 * Krusty adapter checks prove WASM outputs are validated at the crypto boundary.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@mc-wallet/kms-krusty/adapter";

const createModule = (signatureR = "0x1") => ({
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
});

describe("createKrustyKms", () => {
  test("requires every Krusty export at construction", () => {
    expect(() => createKrustyKms({ ...createModule(), signStarkHash: undefined })).toThrow(
      "Krusty KMS export missing: signStarkHash",
    );
  });

  test("rejects inherited Krusty exports", () => {
    const { signStarkHash, ...moduleExports } = createModule();
    const module = Object.create({ signStarkHash: createModule().signStarkHash }) as Record<
      string,
      unknown
    >;
    Object.assign(module, moduleExports);

    expect(() => createKrustyKms(module)).toThrow("Krusty KMS export missing: signStarkHash");
  });

  test("returns field-element account derivation results", async () => {
    const kms = createKrustyKms(createModule());

    await expect(kms.deriveScopedStrk20ViewingKey("0x123", "0x1", "0x2")).resolves.toBe("0x456");
    await expect(kms.deriveStarknetKeypair("seed words", 0, 0)).resolves.toEqual({
      privateKey: "0x123",
      publicKeyX: "0xabc",
      publicKeyY: "0xdef",
    });
    await expect(kms.deriveOzAccountAddress("0xabc", "0x123")).resolves.toBe("0xabc");
  });

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

  test("rejects invalid derivation inputs before WASM calls", async () => {
    let addressDerived = false;
    let keypairDerived = false;
    let viewingKeyDerived = false;
    const module = {
      ...createModule(),
      deriveOzAccountAddress() {
        addressDerived = true;
        return "0xabc";
      },
      deriveStarknetKeypair() {
        keypairDerived = true;
        return {
          private_key: "0x123",
          public_key_x: "0xabc",
          public_key_y: "0xdef",
        };
      },
      deriveStrk20ViewingKey() {
        viewingKeyDerived = true;
        return "0x456";
      },
    };
    const kms = createKrustyKms(module);

    await expect(kms.deriveOzAccountAddress("not-hex", "0x123")).rejects.toThrow(
      "Invalid Stark address derivation input",
    );
    await expect(kms.deriveStarknetKeypair("seed words", -1, 0)).rejects.toThrow(
      "Invalid Stark derivation input",
    );
    await expect(kms.deriveStarknetKeypair("   ", 0, 0)).rejects.toThrow(
      "Invalid Stark derivation input",
    );
    await expect(kms.deriveScopedStrk20ViewingKey("0x0", "0x1", "0x2")).rejects.toThrow(
      "Invalid STRK20 viewing-key input",
    );
    await expect(kms.deriveScopedStrk20ViewingKey("0x1", "0x0", "0x2")).rejects.toThrow(
      "Invalid STRK20 viewing-key input",
    );
    expect(addressDerived).toBe(false);
    expect(keypairDerived).toBe(false);
    expect(viewingKeyDerived).toBe(false);
  });

  test("rejects invalid derivation outputs", async () => {
    await expect(
      createKrustyKms({
        ...createModule(),
        deriveOzAccountAddress() {
          return "not-hex";
        },
      }).deriveOzAccountAddress("0xabc", "0x123"),
    ).rejects.toThrow("Krusty KMS returned an invalid account address");
    await expect(
      createKrustyKms({
        ...createModule(),
        deriveStarknetKeypair() {
          return {
            private_key: "0x0",
            public_key_x: "0xabc",
            public_key_y: "0xdef",
          };
        },
      }).deriveStarknetKeypair("seed words", 0, 0),
    ).rejects.toThrow("Krusty KMS result missing non-zero private key: private_key");
    await expect(
      createKrustyKms({
        ...createModule(),
        deriveStarknetKeypair() {
          return {
            private_key: "0x123",
            public_key_x: "0x800000000000011000000000000000000000000000000000000000000000001",
            public_key_y: "0xdef",
          };
        },
      }).deriveStarknetKeypair("seed words", 0, 0),
    ).rejects.toThrow("Krusty KMS result missing field element: public_key_x");
    await expect(
      createKrustyKms({
        ...createModule(),
        deriveScopedStrk20ViewingKey() {
          return "0x0";
        },
      }).deriveScopedStrk20ViewingKey("0x123", "0x1", "0x2"),
    ).rejects.toThrow("Krusty KMS returned an invalid STRK20 viewing key");
  });

  test("returns hex signatures from valid WASM output", async () => {
    await expect(createKrustyKms(createModule()).signStarkHash("0x123", "0x1")).resolves.toEqual({
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    });
  });

  test("rejects non-hex signature fields", async () => {
    await expect(
      createKrustyKms(createModule("not-hex")).signStarkHash("0x123", "0x1"),
    ).rejects.toThrow("Krusty KMS result missing field element: r");
    await expect(
      createKrustyKms(
        createModule("0x800000000000011000000000000000000000000000000000000000000000001"),
      ).signStarkHash("0x123", "0x1"),
    ).rejects.toThrow("Krusty KMS result missing field element: r");
  });

  test("rejects zero signature fields", async () => {
    await expect(
      createKrustyKms(createModule("0x0")).signStarkHash("0x123", "0x1"),
    ).rejects.toThrow("Krusty KMS result missing non-zero field element: r");
  });

  test("rejects inherited Krusty result fields", async () => {
    await expect(
      createKrustyKms({
        ...createModule(),
        signStarkHash() {
          return Object.create(
            { r: "0x1" },
            {
              publicKey: { enumerable: true, value: "0xabc" },
              s: { enumerable: true, value: "0x2" },
            },
          );
        },
      }).signStarkHash("0x123", "0x1"),
    ).rejects.toThrow("Krusty KMS result missing string field: r");
  });

  test("rejects invalid signing inputs before WASM signing", async () => {
    let signed = false;
    const module = {
      ...createModule(),
      signStarkHash() {
        signed = true;
        return {
          publicKey: "0xabc",
          r: "0x1",
          s: "0x2",
        };
      },
    };

    await expect(createKrustyKms(module).signStarkHash("not-hex", "0x1")).rejects.toThrow(
      "Invalid Stark signing input",
    );
    await expect(createKrustyKms(module).signStarkHash("0x0", "0x1")).rejects.toThrow(
      "Invalid Stark signing input",
    );
    expect(signed).toBe(false);
  });

  test("rejects invalid mnemonic word counts before WASM generation", async () => {
    let generated = false;
    const module = {
      ...createModule(),
      generateMnemonic() {
        generated = true;
        return "habit hope tip crystal because grunt nation idea electric witness alert like";
      },
    };

    await expect(createKrustyKms(module).generateMnemonic(13)).rejects.toThrow(
      "Invalid mnemonic word count",
    );
    expect(generated).toBe(false);
  });

  test("rejects invalid generated mnemonics", async () => {
    await expect(
      createKrustyKms({
        ...createModule(),
        generateMnemonic() {
          return "";
        },
      }).generateMnemonic(),
    ).rejects.toThrow("Krusty KMS returned an invalid mnemonic");
  });

  test("rejects blank mnemonic validation before WASM calls", async () => {
    let validated = false;
    const module = {
      ...createModule(),
      validateMnemonic() {
        validated = true;
        return true;
      },
    };

    await expect(createKrustyKms(module).validateMnemonic(" ")).rejects.toThrow("Invalid mnemonic");
    expect(validated).toBe(false);
  });
});
