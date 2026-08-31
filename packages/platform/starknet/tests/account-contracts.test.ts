/** Golden ABI vectors and adversarial validation for pinned Argent accounts. */

import { describe, expect, test } from "bun:test";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
  argentAccountAddress,
  argentAccountConstructorCalldata,
  argentMultisigAddress,
  argentMultisigConstructorCalldata,
  argentSignerGuid,
  estimateMode,
  serializeAccountSignature,
  serializeArgentAccountSignature,
  serializeArgentMultisigDeploySignature,
  serializeArgentMultisigSignature,
  usesValidatedQueryEstimate,
} from "@mc-wallet/starknet/account-contracts";
import { hash } from "starknet";

const FIRST = "0x123";
const SECOND = "0x456";
const CONFIG = { signerPublicKeys: [SECOND, FIRST], threshold: 2 } as const;

describe("pinned Argent account contracts", () => {
  test("pins the update-2024Q2 declarations and compiled classes", () => {
    expect(ARGENT_ACCOUNT_CONTRACT).toEqual({
      classHash: "0x036078334509b514626504edc9fb252328d1a240e4e948bef8d0c08dff45927f",
      compiledClassHash: "0x0294a323246c017d00a98f11942e1e38d562c97bc79426742110a14ce497e9b5",
      upstreamCommit: "1352198956f36fb35fa544c4e46a3507a3ec20e3",
      version: "0.4.0",
    });
    expect(ARGENT_MULTISIG_CONTRACT).toEqual({
      classHash: "0x07aeca3456816e3b833506d7cc5c1313d371fbdb0ae95ee70af72a4ddbf42594",
      compiledClassHash: "0x010972dc21f31635a6e90d524295e4e356a565e21dd1dbe986c476dbe9d0f8c9",
      upstreamCommit: "1352198956f36fb35fa544c4e46a3507a3ec20e3",
      version: "0.2.0",
    });
  });

  test("matches upstream constructor enum and Option encodings", () => {
    expect(argentAccountConstructorCalldata(FIRST)).toEqual(["0", FIRST, "1"]);
    expect(argentMultisigConstructorCalldata(CONFIG)).toEqual(["2", "2", "0", FIRST, "0", SECOND]);
  });

  test("matches the upstream Starknet Signer GUID domain", () => {
    expect(argentSignerGuid(FIRST)).toBe(
      "0x116dcea0b31d06f721c156324cd8de3652bf8953cd5ba055f74db21b1134ec9",
    );
    expect(argentSignerGuid(SECOND)).toBe(
      "0x44262798138cf2be1f7fee96be6f7ce9030bec80801437fe00903a65ae72e59",
    );
  });

  test("uses deterministic class, salt, and constructor commitments", () => {
    expect(argentAccountAddress(FIRST)).toBe(
      hash.calculateContractAddressFromHash(
        FIRST,
        ARGENT_ACCOUNT_CONTRACT.classHash,
        [...argentAccountConstructorCalldata(FIRST)],
        0,
      ),
    );
    const salt = "0xabc";
    expect(argentMultisigAddress(CONFIG, salt)).toBe(
      hash.calculateContractAddressFromHash(
        salt,
        ARGENT_MULTISIG_CONTRACT.classHash,
        [...argentMultisigConstructorCalldata(CONFIG)],
        0,
      ),
    );
  });
});

describe("Argent signature serialization", () => {
  const first = { publicKey: FIRST, r: "0x1", s: "0x2" };
  const second = { publicKey: SECOND, r: "0x3", s: "0x4" };

  test("uses the standard single-signer format", () => {
    expect(serializeArgentAccountSignature(first)).toEqual(["1", "0", FIRST, "0x1", "0x2"]);
    expect(
      serializeAccountSignature("openzeppelin", {
        publicKey: "0x0123",
        r: "0x01",
        s: "0x02",
      }),
    ).toEqual(["0x1", "0x2"]);
  });

  test("sorts an exact threshold aggregate by signer GUID", () => {
    expect(serializeArgentMultisigSignature([second, first], CONFIG)).toEqual([
      "2",
      "0",
      FIRST,
      "0x1",
      "0x2",
      "0",
      SECOND,
      "0x3",
      "0x4",
    ]);
  });

  test("allows one configured signature only for deployment", () => {
    expect(serializeArgentMultisigDeploySignature(second, CONFIG)).toEqual([
      "1",
      "0",
      SECOND,
      "0x3",
      "0x4",
    ]);
  });

  test("rejects duplicates, outsiders, wrong counts, and oversized sets", () => {
    expect(() => serializeArgentMultisigSignature([first, first], CONFIG)).toThrow("distinct");
    expect(() =>
      serializeArgentMultisigSignature([first, { publicKey: "0x789", r: "0x5", s: "0x6" }], CONFIG),
    ).toThrow("configured signer");
    expect(() => serializeArgentMultisigSignature([first], CONFIG)).toThrow("exactly 2");
    expect(() =>
      argentMultisigConstructorCalldata({
        signerPublicKeys: Array.from({ length: 33 }, (_, index) => `0x${(index + 1).toString(16)}`),
        threshold: 1,
      }),
    ).toThrow("threshold or signer count");

    const sparse = new Array<string>(2);
    sparse[1] = FIRST;
    expect(() =>
      argentMultisigConstructorCalldata({ signerPublicKeys: sparse, threshold: 1 }),
    ).toThrow("signer public key");
  });
});

describe("estimateMode", () => {
  test("only the post-quantum family estimates through its own query dummy", () => {
    // The distinction the boolean this replaced could not express: ML-DSA needs
    // validation included in the estimate but cannot borrow Argent's query
    // account, whose dummy is a Stark `(r, s)` its `__validate__` never reads.
    expect(estimateMode("ml-dsa")).toBe("ml-dsa-query");
    expect(estimateMode("argent")).toBe("argent-query");
    expect(estimateMode("argent-multisig")).toBe("argent-query");
    expect(estimateMode("openzeppelin")).toBe("skip-validate");
  });

  test("every family except OpenZeppelin includes validation in its estimate", () => {
    // OZ is the only one whose `__validate__` is cheap enough to leave out — and
    // leaving it out is also what keeps a review from waking a Ledger.
    for (const family of ["argent", "argent-multisig", "ml-dsa"] as const) {
      expect(usesValidatedQueryEstimate(family)).toBe(true);
    }
    expect(usesValidatedQueryEstimate("openzeppelin")).toBe(false);
  });
});
