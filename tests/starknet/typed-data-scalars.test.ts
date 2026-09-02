/**
 * Scalar leaves are type-directed: a value is only signable under a declared
 * SNIP-12 type when that type can actually mean it, and what the wallet accepts
 * has to encode to the felt the pinned library hashes.
 *
 * The rules being pinned here exist because the library's own leaf reading is
 * asymmetric. `getHex` tries `BigInt(value)` first and falls back to
 * `encodeShortString`, and revision 0 range-checks nothing at all, so before
 * this every string, number and boolean was a valid value for every leaf type:
 * a sentence under a `u128` hashed as a 128-bit number, the string `"false"`
 * under a `felt` hashed as a nonzero felt while the boolean `false` hashed as
 * zero, and `" 12 "`, `"+12"` and `"0b101"` were three more spellings of 12
 * that a reader would not recognise as numbers at all.
 *
 * Three properties are asserted, on both revisions:
 *
 *  - what each type admits, by name, including the spellings it must refuse;
 *  - agreement with the pinned encoder: every accepted value carries the exact
 *    felt `encodeValue` produces for it, and no accepted value is one the
 *    library would throw on;
 *  - the hashing gate refuses at the envelope what the scalar reader refuses at
 *    the leaf, so the property holds where signing is actually decided.
 */
import { describe, expect, test } from "bun:test";
import { snip12Scalar } from "@bramble/starknet/snip12-scalars";
import { isTypedDataShape } from "@bramble/starknet/typed-data";
import { sameFelt } from "@bramble/wallet-model/networks";
import { typedData as snip12 } from "starknet";

type Revision = "0" | "1";

const REV1_DOMAIN = [
  { name: "name", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];
const REV0_DOMAIN = [{ name: "name", type: "felt" }];

// One message field of one declared type: the smallest envelope in which a leaf
// value decides whether the whole payload may be signed.
const envelope = (revision: Revision, type: string, value: unknown): unknown =>
  revision === "1"
    ? {
        domain: { name: "Bramble Test", revision: "1" },
        message: { v: value },
        primaryType: "Msg",
        types: { Msg: [{ name: "v", type }], StarknetDomain: REV1_DOMAIN },
      }
    : {
        domain: { name: "Bramble Test" },
        message: { v: value },
        primaryType: "Msg",
        types: { Msg: [{ name: "v", type }], StarkNetDomain: REV0_DOMAIN },
      };

// The library's own leaf encoding, or null when it refuses the value. An empty
// type map resolves no struct and no preset, so for a basic type this is exactly
// the encoder the message hash is built from.
const libraryEncoding = (revision: Revision, type: string, value: unknown): string | null => {
  try {
    return snip12.encodeValue({} as never, type, value as never, undefined, revision as never)[1];
  } catch {
    return null;
  }
};

const accepts = (revision: Revision, type: string, value: unknown): boolean =>
  snip12Scalar(value, type, revision) !== null;

describe("SNIP-12 scalars are read against their declared type", () => {
  test("a numeric type refuses text, on both revisions", () => {
    // Revision 0 applies no range check at all, so this is the revision where a
    // benign-looking phrase reaches the hash as a large number: the library
    // encodes it through `encodeShortString` and a verifier reads the felt.
    for (const revision of ["0", "1"] as const) {
      for (const type of ["u128", "timestamp", "i128", "ContractAddress", "ClassHash"] as const) {
        expect(accepts(revision, type, "no fee required")).toBe(false);
        expect(accepts(revision, type, "unlimited")).toBe(false);
        expect(accepts(revision, type, "false")).toBe(false);
        // The numeric spelling of the same authority stays acceptable — the
        // wallet refuses the disguise, not the value.
        expect(accepts(revision, type, "0x6e6f20666565207265717569726564")).toBe(true);
      }
    }
  });

  test("prose under a numeric type is refused at the hashing gate too", () => {
    for (const revision of ["0", "1"] as const) {
      expect(isTypedDataShape(envelope(revision, "u128", "no fee required"))).toBe(false);
      expect(isTypedDataShape(envelope(revision, "u128", "0x6e6f20666565207265717569726564"))).toBe(
        true,
      );
    }
  });

  test("a boolean and the string spelling of one are never interchangeable", () => {
    for (const revision of ["0", "1"] as const) {
      // `bool` is the type that means a boolean; nothing else admits one, and
      // `bool` admits nothing else. The string "false" encodes to a nonzero
      // felt, so the two can never be the same row on screen.
      expect(accepts(revision, "bool", false)).toBe(true);
      expect(accepts(revision, "bool", "false")).toBe(false);
      expect(accepts(revision, "bool", 0)).toBe(false);
      expect(accepts(revision, "felt", false)).toBe(false);
      expect(accepts(revision, "felt", "false")).toBe(true);
      expect(isTypedDataShape(envelope(revision, "felt", false))).toBe(false);
    }
  });

  test("only unambiguous numeric text is read as a number", () => {
    for (const revision of ["0", "1"] as const) {
      for (const accepted of ["1000", "0x3e8", "0x03e8", "0X3E8", "007", 1000]) {
        expect(accepts(revision, "u128", accepted)).toBe(true);
      }
      // Every one of these parses as a number for `BigInt` and would be hashed
      // as one, while reading as anything but a number on screen.
      for (const refused of ["", "  ", " 12 ", "+12", "0b101", "0o17", "-0"]) {
        expect(accepts(revision, "u128", refused)).toBe(false);
        expect(accepts(revision, "felt", refused)).toBe(false);
      }
      // …and refusing them at the leaf refuses the payload.
      expect(isTypedDataShape(envelope(revision, "felt", " 12 "))).toBe(false);
    }
  });

  test("each integer type is held to its own range", () => {
    const u128Max = (1n << 128n) - 1n;
    const i128Min = -(1n << 127n);
    const feltMax = BigInt("0x800000000000011000000000000000000000000000000000000000000000000");
    for (const revision of ["0", "1"] as const) {
      expect(accepts(revision, "u128", u128Max.toString())).toBe(true);
      expect(accepts(revision, "u128", (u128Max + 1n).toString())).toBe(false);
      expect(accepts(revision, "timestamp", "0")).toBe(true);
      expect(accepts(revision, "felt", feltMax.toString())).toBe(true);
      expect(accepts(revision, "felt", (feltMax + 1n).toString())).toBe(false);
      expect(accepts(revision, "ContractAddress", (feltMax + 1n).toString())).toBe(false);
    }
    // Only revision 1 wraps a negative `i128` into the field; revision 0 would
    // hand the hash the unparsable `0x-1`, so it admits no negative at all.
    expect(accepts("1", "i128", i128Min.toString())).toBe(true);
    expect(accepts("1", "i128", (i128Min - 1n).toString())).toBe(false);
    expect(accepts("1", "i128", "-1")).toBe(true);
    expect(accepts("0", "i128", "-1")).toBe(false);
  });

  test("short strings stay short, printable, and ASCII", () => {
    const thirtyOne = "a".repeat(31);
    for (const revision of ["0", "1"] as const) {
      expect(accepts(revision, "shortstring", thirtyOne)).toBe(true);
      expect(accepts(revision, "shortstring", `${thirtyOne}a`)).toBe(false);
      expect(accepts(revision, "felt", "SN_MAIN")).toBe(true);
      expect(accepts(revision, "felt", "héllo")).toBe(false);
      expect(accepts(revision, "felt", "two‮lines")).toBe(false);
    }
    // A revision 1 `string` is a ByteArray of short strings, so it may be long
    // but is still ASCII-only; on revision 0 the same type is a plain felt.
    expect(accepts("1", "string", "a".repeat(200))).toBe(true);
    expect(accepts("0", "string", "a".repeat(200))).toBe(false);
    expect(accepts("1", "string", "héllo")).toBe(false);
    expect(accepts("1", "string", 12)).toBe(false);
  });

  test("a selector is an entry point name or a felt, and nothing else", () => {
    for (const revision of ["0", "1"] as const) {
      expect(accepts(revision, "selector", "transfer")).toBe(true);
      expect(accepts(revision, "selector", "0x3e8")).toBe(true);
      // A sentence hashes to a selector just as happily as a name does, and
      // reads as a sentence on screen.
      expect(accepts(revision, "selector", "transfer 1 STRK to the treasury")).toBe(false);
      expect(accepts(revision, "selector", 12)).toBe(false);
      expect(accepts(revision, "selector", "0x")).toBe(false);
    }
  });

  test("every accepted value carries the felt the pinned encoder produces", () => {
    const types = [
      "felt",
      "shortstring",
      "string",
      "u128",
      "i128",
      "timestamp",
      "ContractAddress",
      "ClassHash",
      "bool",
      "selector",
    ];
    const values: readonly unknown[] = [
      "no fee required",
      "0x6e6f20666565207265717569726564",
      "false",
      "true",
      false,
      true,
      "1000",
      1000,
      "0x3e8",
      "0x03e8",
      "007",
      7,
      "-5",
      -5,
      "",
      " 12 ",
      "+12",
      "0b101",
      "0X1F",
      "1_000",
      "0x",
      "transfer",
      "SN_MAIN",
      "a b",
      "0",
      "0x0",
      1.5,
      "12.0",
      "340282366920938463463374607431768211455",
      "340282366920938463463374607431768211456",
      "héllo",
    ];
    let checked = 0;
    for (const revision of ["0", "1"] as const) {
      for (const type of types) {
        for (const value of values) {
          const resolved = snip12Scalar(value, type, revision);
          if (resolved === null) {
            continue;
          }
          const encoded = libraryEncoding(revision, type, value);
          // An accepted value the library would throw on is worse than a
          // refused one: the card would describe a payload that never hashes.
          expect(encoded).not.toBeNull();
          expect(sameFelt(resolved.encoded, encoded ?? "")).toBe(true);
          checked += 1;
        }
      }
    }
    // The sweep is only evidence if it accepted a broad set in the first place.
    expect(checked).toBeGreaterThan(80);
  });
});
