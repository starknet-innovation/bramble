/**
 * Krusty KMS adapter defensive branches not exercised by the main suite: the
 * non-object module throw, the one shared module init, the successful
 * generateMnemonic and getAccountClassHashes happy paths plus their "returned
 * invalid X" throws, and validateMnemonic returning a real boolean vs a
 * non-boolean WASM result.
 */
import { describe, expect, test } from "bun:test";
import { createKrustyKms } from "@bramble/kms-krusty/adapter";

const MNEMONIC = "habit hope tip crystal because grunt nation idea electric witness alert like";

const createModule = (overrides: Record<string, unknown> = {}) => ({
  deriveArgentLegacyKeypair() {
    return {
      private_key: "0x321",
      public_key_x: "0xcba",
    };
  },
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
    return { private_key: "0x123", public_key_x: "0xabc", public_key_y: "0xdef" };
  },
  generateMnemonic() {
    return MNEMONIC;
  },
  getAccountClassHashes() {
    return "{}";
  },
  openNostrApplicationData() {
    return JSON.stringify({
      content: "payload",
      identifier: "bramble.multisig",
      senderPublicKey: "22".repeat(32),
    });
  },
  signStarkHash() {
    return { publicKey: "0xabc", r: "0x1", s: "0x2" };
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
  ...overrides,
});

describe("createKrustyKms module boundary", () => {
  test("throws when the WASM module is not an object", () => {
    expect(() => createKrustyKms(42)).toThrow("Krusty KMS module did not load as an object");
    expect(() => createKrustyKms(null)).toThrow("Krusty KMS module did not load as an object");
  });
});

// Models the wasm-bindgen `web` glue Krusty ships: its init checks for a finished instance only on
// entry and then awaits the fetch and compile, and every export works on the current instance.
const createGluedModule = () => {
  let instance: number | undefined;
  let instantiations = 0;
  const compiling: Array<() => void> = [];
  const module = createModule({
    async default() {
      if (instance !== undefined) return instance;
      instantiations += 1;
      const id = instantiations;
      await new Promise<void>((finish) => compiling.push(finish));
      instance = id;
      return instance;
    },
    validateMnemonic() {
      if (instance === undefined) throw new Error("Krusty used before its init finished");
      return true;
    },
  });
  return {
    finishCompiling: () => {
      for (const finish of compiling.splice(0)) finish();
    },
    instantiations: () => instantiations,
    module,
  };
};

describe("createKrustyKms module init", () => {
  test("every KMS built while the first init is pending shares its one instance", async () => {
    // A second instance would replace the first under every live Krusty object, so its getters and
    // FinalizationRegistry frees would run against the wrong heap (the CI `malloc` trap).
    const glue = createGluedModule();
    const answers = Promise.all([
      createKrustyKms(glue.module).validateMnemonic(MNEMONIC),
      createKrustyKms(glue.module).validateMnemonic(MNEMONIC),
      createKrustyKms({ ...glue.module }).validateMnemonic(MNEMONIC),
    ]);
    glue.finishCompiling();

    await expect(answers).resolves.toEqual([true, true, true]);
    expect(glue.instantiations()).toBe(1);
    await expect(createKrustyKms(glue.module).validateMnemonic(MNEMONIC)).resolves.toBe(true);
    expect(glue.instantiations()).toBe(1);
  });

  test("a failed init fails every KMS built from the module, without retrying", async () => {
    let inits = 0;
    const module = createModule({
      default() {
        inits += 1;
        return Promise.reject(new Error("Krusty WASM failed to load"));
      },
    });

    await expect(createKrustyKms(module).validateMnemonic(MNEMONIC)).rejects.toThrow(
      "Krusty WASM failed to load",
    );
    await expect(createKrustyKms(module).generateMnemonic()).rejects.toThrow(
      "Krusty WASM failed to load",
    );
    expect(inits).toBe(1);
  });
});

describe("generateMnemonic output validation", () => {
  test("returns a valid generated mnemonic", async () => {
    await expect(createKrustyKms(createModule()).generateMnemonic()).resolves.toBe(MNEMONIC);
  });

  test("supports an explicit supported word count", async () => {
    await expect(createKrustyKms(createModule()).generateMnemonic(24)).resolves.toBe(MNEMONIC);
  });

  test("throws when the WASM mnemonic is blank", async () => {
    await expect(
      createKrustyKms(createModule({ generateMnemonic: () => "   " })).generateMnemonic(),
    ).rejects.toThrow("Krusty KMS returned an invalid mnemonic");
  });
});

describe("getAccountClassHashes output validation", () => {
  test("returns the raw class-hash JSON string", async () => {
    const hashes = JSON.stringify({ oz: {} });
    await expect(
      createKrustyKms(
        createModule({ getAccountClassHashes: () => hashes }),
      ).getAccountClassHashes(),
    ).resolves.toBe(hashes);
  });

  test("throws when the WASM result is not a string", async () => {
    await expect(
      createKrustyKms(createModule({ getAccountClassHashes: () => ({}) })).getAccountClassHashes(),
    ).rejects.toThrow("Krusty KMS returned invalid class hashes");
  });
});

describe("validateMnemonic output validation", () => {
  test("returns the WASM boolean verdict for a non-blank mnemonic", async () => {
    await expect(createKrustyKms(createModule()).validateMnemonic(MNEMONIC)).resolves.toBe(true);
    await expect(
      createKrustyKms(createModule({ validateMnemonic: () => false })).validateMnemonic(MNEMONIC),
    ).resolves.toBe(false);
  });

  test("throws when the WASM validation result is not a boolean", async () => {
    await expect(
      createKrustyKms(createModule({ validateMnemonic: () => "yes" })).validateMnemonic(MNEMONIC),
    ).rejects.toThrow("Krusty KMS returned an invalid mnemonic validation result");
  });
});
