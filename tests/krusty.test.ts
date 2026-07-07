/**
 * Krusty adapter checks prove WASM outputs are validated at the crypto boundary.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "../src/crypto/krusty";

const createModule = (signatureR = "0x1") => ({
  deriveOzAccountAddress() {
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
    expect(addressDerived).toBe(false);
    expect(keypairDerived).toBe(false);
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
