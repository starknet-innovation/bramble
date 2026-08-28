/**
 * Krusty adapter checks prove WASM outputs are validated at the crypto boundary.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@mc-wallet/kms-krusty/adapter";
import { STARK_CURVE_ORDER } from "@mc-wallet/wallet-model/networks";

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

    await expect(kms.deriveStrk20ViewingKey("0x123", "0x1", "0x2")).resolves.toBe("0x456");
    await expect(kms.deriveStarknetKeypair("seed words", 0, 0)).resolves.toEqual({
      privateKey: "0x123",
      publicKeyX: "0xabc",
      publicKeyY: "0xdef",
    });
    await expect(kms.deriveOzAccountAddress("0xabc", "0x123")).resolves.toBe("0xabc");
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
      deriveScopedStrk20ViewingKey() {
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
    await expect(kms.deriveStrk20ViewingKey("0x0", "0x1", "0x2")).rejects.toThrow(
      "Invalid STRK20 viewing-key input",
    );
    await expect(kms.deriveStrk20ViewingKey("0x1", "0x0", "0x2")).rejects.toThrow(
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
      }).deriveStrk20ViewingKey("0x123", "0x1", "0x2"),
    ).rejects.toThrow("Krusty KMS returned an invalid STRK20 viewing key");
  });

  test("returns hex signatures from valid WASM output", async () => {
    await expect(createKrustyKms(createModule()).signStarkHash("0x123", "0x1")).resolves.toEqual({
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    });
  });

  test("canonicalizes accepted KMS outputs", async () => {
    const module = {
      ...createModule("0x01"),
      deriveOzAccountAddress() {
        return "0x0abc";
      },
      signStarkHash() {
        return { publicKey: "0x0abc", r: "0x01", s: "0x02" };
      },
    };
    await expect(createKrustyKms(module).signStarkHash("0x123", "0x1")).resolves.toEqual({
      publicKey: "0xabc",
      r: "0x1",
      s: "0x2",
    });
    await expect(createKrustyKms(module).deriveOzAccountAddress("0xabc", "0x123")).resolves.toBe(
      "0xabc",
    );
  });

  test("rejects signature scalars at the Stark curve order", async () => {
    await expect(
      createKrustyKms(createModule(`0x${STARK_CURVE_ORDER.toString(16)}`)).signStarkHash(
        "0x123",
        "0x1",
      ),
    ).rejects.toThrow("Krusty KMS result missing non-zero private key: r");
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
    ).rejects.toThrow("Krusty KMS result missing non-zero private key: r");
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

  test("keeps Nostr key derivation and gift wrapping inside the WASM boundary", async () => {
    const calls: unknown[][] = [];
    const module = {
      ...createModule(),
      deriveNostrPublicKey(...args: unknown[]) {
        calls.push(args);
        return { public_key: "11".repeat(32) };
      },
      openNostrApplicationData(...args: unknown[]) {
        calls.push(args);
        return JSON.stringify({
          content: "payload",
          identifier: "mc-wallet.multisig",
          senderPublicKey: "22".repeat(32),
        });
      },
      wrapNostrApplicationData(...args: unknown[]) {
        calls.push(args);
        return createModule().wrapNostrApplicationData();
      },
    };
    const kms = createKrustyKms(module);
    const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";
    const giftWrap = createModule().wrapNostrApplicationData();

    await expect(kms.deriveNostrPublicKey(mnemonic, 1, 2, "phrase")).resolves.toBe("11".repeat(32));
    await expect(
      kms.wrapNostrApplicationData(
        mnemonic,
        1,
        2,
        "44".repeat(32),
        "mc wallet.multisig",
        "payload",
        "phrase",
      ),
    ).resolves.toBe(giftWrap);
    await expect(kms.openNostrApplicationData(mnemonic, 1, 2, giftWrap, "phrase")).resolves.toEqual(
      {
        content: "payload",
        identifier: "mc-wallet.multisig",
        senderPublicKey: "22".repeat(32),
      },
    );
    expect(calls).toEqual([
      [mnemonic, 1, 2, "phrase"],
      [mnemonic, 1, 2, "phrase", "44".repeat(32), "mc wallet.multisig", "payload"],
      [mnemonic, 1, 2, "phrase", giftWrap],
    ]);
  });

  test("rejects malformed Nostr application data before calling WASM", async () => {
    let wrapped = false;
    const kms = createKrustyKms({
      ...createModule(),
      wrapNostrApplicationData() {
        wrapped = true;
        return "{}";
      },
    });
    const mnemonic = "habit hope tip crystal because grunt nation idea electric witness alert like";

    await expect(
      kms.wrapNostrApplicationData(mnemonic, 0, 0, "44".repeat(32), "not printable\n", "payload"),
    ).rejects.toThrow("Invalid Nostr application-data input");
    await expect(
      kms.wrapNostrApplicationData(
        mnemonic,
        0,
        0,
        "44".repeat(32),
        "mc-wallet.multisig",
        "🦊".repeat(20_000),
      ),
    ).rejects.toThrow("Invalid Nostr application-data input");
    expect(wrapped).toBe(false);

    const wrongKind = JSON.parse(createModule().wrapNostrApplicationData()) as Record<
      string,
      unknown
    >;
    wrongKind["kind"] = 1;
    await expect(
      createKrustyKms({
        ...createModule(),
        wrapNostrApplicationData: () => JSON.stringify(wrongKind),
      }).wrapNostrApplicationData(mnemonic, 0, 0, "44".repeat(32), "mc-wallet.multisig", "payload"),
    ).rejects.toThrow("Krusty KMS returned an invalid Nostr gift wrap");
  });
});
