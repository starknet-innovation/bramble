/**
 * The ML-DSA contract table. One family, several contracts, and the wallet's job
 * is identical across all of them except for three things — the constructor, the
 * class-hash provenance, and the signature-felt count. These pin those three,
 * and pin that an unanswered one refuses by name rather than borrowing another
 * contract's answer, which would produce an address nobody holds the key for.
 */
import { describe, expect, test } from "bun:test";
import {
  ML_DSA_ADDRESS_SALT,
  mlDsaAccountAddress,
  mlDsaClassSpec,
  mlDsaConstructorCalldata,
} from "@mc-wallet/starknet/ml-dsa-classes";
import { isMlDsaKind, type MlDsaKind } from "@mc-wallet/wallet-model/accounts";
import { ML_DSA_65_PUBLIC_KEY_BYTES } from "@mc-wallet/wallet-model/signing";

const KINDS: readonly MlDsaKind[] = ["const", "storage", "hashkey"];
const publicKey = `0x${"ab".repeat(ML_DSA_65_PUBLIC_KEY_BYTES)}`;

describe("ML-DSA contract table", () => {
  test("covers exactly the contracts the account model admits", () => {
    for (const kind of KINDS) {
      expect(isMlDsaKind(kind)).toBe(true);
      expect(mlDsaClassSpec(kind)).toBeDefined();
    }
    expect(isMlDsaKind("stwo")).toBe(false);
    expect(isMlDsaKind("")).toBe(false);
  });

  test("records the measured signature-felt cost of each contract", () => {
    // 905 for the felt-native signature plus its verification hints; `hashkey`
    // carries the 925-felt packed key on top, in every transaction.
    expect(mlDsaClassSpec("const").signatureFelts).toBe(905);
    expect(mlDsaClassSpec("storage").signatureFelts).toBe(905);
    expect(mlDsaClassSpec("hashkey").signatureFelts).toBe(1830);
    expect(1830 - 905).toBe(925);
  });

  test("only the const contract has a per-user class", () => {
    // Its key is compiled into the class, so the class hash is the commitment to
    // the public key — and there is no shared release to pin a deployed class
    // against. The others share one class.
    expect(mlDsaClassSpec("const").classHashSource).toBe("per-user");
    expect(mlDsaClassSpec("storage").classHashSource).toBe("shared");
    expect(mlDsaClassSpec("hashkey").classHashSource).toBe("shared");
  });

  test("the const contract takes no constructor arguments", () => {
    expect(mlDsaConstructorCalldata("const", publicKey)).toEqual([]);
  });

  test("contracts needing the packed key refuse by name", () => {
    // The 925-felt packed form of a 1952-byte FIPS 204 key needs ML-DSA key
    // expansion, which this layer cannot do. Refusing beats guessing: a wrong
    // preimage yields a plausible address nobody can sign for.
    for (const kind of ["storage", "hashkey"] as const) {
      expect(() => mlDsaConstructorCalldata(kind, publicKey)).toThrow(
        `ML-DSA ${kind} account deployment parameters are not yet defined`,
      );
      expect(() => mlDsaAccountAddress(kind, "0xabc", publicKey)).toThrow("not yet defined");
    }
  });

  test("the const address is a function of the class hash and nothing else", () => {
    const address = mlDsaAccountAddress("const", "0xabc", publicKey);
    expect(address).toBe(mlDsaAccountAddress("const", "0xabc", publicKey));
    // The key is in the class, not the preimage.
    expect(
      mlDsaAccountAddress("const", "0xabc", `0x${"cd".repeat(ML_DSA_65_PUBLIC_KEY_BYTES)}`),
    ).toBe(address);
    expect(mlDsaAccountAddress("const", "0xdef", publicKey)).not.toBe(address);
    expect(ML_DSA_ADDRESS_SALT).toBe("0x0");
  });
});
