/**
 * MCW-V09-101, container half: the two SNIP-12 constructs whose declared shape
 * never reaches `encodeType`, and the rules that keep them unambiguous anyway.
 *
 * - `merkletree` omits its `contains` leaf type from the encoding. With a
 *   basic-type leaf the leaf hash *is* the felt the site supplied, so a site can
 *   paste an honest payload's leaf hashes in under a `felt` declaration and
 *   reach the same root — the finding's own construction, reproduced here on
 *   both revisions before it is asserted refused. A struct or preset leaf hashes
 *   as `H(typeHash, …values)`, which turns the substitution into a preimage.
 * - An `enum` field encodes as `"f":"Variants"`, exactly like a plain reference
 *   to the same type. Variant lists and ordinary structs are kept disjoint by
 *   shape: non-empty, all-tuple, and reachable only through the enum field that
 *   names them.
 *
 * The differential sweep that shows those rules leave no residue is in
 * `typed-data-injectivity.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { typedData as snip12 } from "starknet";
import { isTypedDataShape, typedDataHash } from "../../src/starknet/typed-data";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const REV1_DOMAIN_TYPE = [{ name: "name", type: "shortstring" }];
const REV0_DOMAIN_TYPE = [{ name: "name", type: "felt" }];

type Revision = "0" | "1";
type Field = { name: string; type: string; contains?: string };
type Graph = { readonly primaryType: string; readonly types: Record<string, Field[]> };

const rawHash = (payload: unknown): string =>
  snip12.getMessageHash(payload as Parameters<typeof snip12.getMessageHash>[0], ACCOUNT);

const envelope = (graph: Graph, message: unknown, revision: Revision): unknown =>
  revision === "1"
    ? {
        domain: { name: "MC Test", revision: "1" },
        message,
        primaryType: graph.primaryType,
        types: { ...graph.types, StarknetDomain: REV1_DOMAIN_TYPE },
      }
    : {
        domain: { name: "MC Test" },
        message,
        primaryType: graph.primaryType,
        types: { ...graph.types, StarkNetDomain: REV0_DOMAIN_TYPE },
      };

// The finding's own construction, expressed once per revision: an honest tree of
// declared leaves, and a tree of raw felts that happen to be those leaves' hashes.
const merklePair = (revision: Revision): { honest: unknown; forged: unknown } => {
  const leafType = revision === "1" ? "ContractAddress" : "felt";
  const honestGraph: Graph = {
    primaryType: "Session",
    types: {
      Policy: [
        { name: "contract_address", type: leafType },
        { name: "selector", type: revision === "1" ? "selector" : "felt" },
      ],
      Session: [{ contains: "Policy", name: "root", type: "merkletree" }],
    },
  };
  const leaves = [
    { contract_address: "0xdead", selector: "0x1" },
    { contract_address: "0xdead", selector: "0x2" },
  ];
  const honest = envelope(honestGraph, { root: leaves }, revision);
  const hashes = leaves.map((leaf) =>
    snip12.getStructHash(
      (honest as { types: Record<string, unknown> }).types as never,
      "Policy",
      leaf as never,
      revision as never,
    ),
  );
  const forged = envelope(
    {
      primaryType: "Session",
      types: { Session: [{ contains: "felt", name: "root", type: "merkletree" }] },
    },
    { root: hashes },
    revision,
  );
  return { forged, honest };
};

describe("a merkle leaf is bound to a declared struct", () => {
  for (const revision of ["0", "1"] as const) {
    test(`the basic-leaf substitution really collides on revision ${revision}`, () => {
      const { forged, honest } = merklePair(revision);
      // Without the leaf rule these are one signature over two structures: the
      // library itself hashes them identically, so the assertion below is not
      // testing a property the pin happens to have lost.
      expect(rawHash(honest)).toBe(rawHash(forged));
      expect(isTypedDataShape(honest)).toBe(true);
      expect(typedDataHash(honest, ACCOUNT)).toBe(rawHash(honest));
      expect(isTypedDataShape(forged)).toBe(false);
      expect(() => typedDataHash(forged, ACCOUNT)).toThrow("Invalid typed data");
    });
  }

  const tree = (contains: string, leaves: readonly unknown[], revision: Revision): unknown =>
    envelope(
      {
        primaryType: "Message",
        types: {
          Inner: [{ name: "leaf", type: "felt" }],
          Message: [{ contains, name: "tree", type: "merkletree" }],
        },
      },
      { tree: leaves },
      revision,
    );

  test("a declared struct leaf and a preset leaf still hash", () => {
    const declared = tree("Inner", [{ leaf: "0x1" }, { leaf: "0x2" }], "1");
    expect(typedDataHash(declared, ACCOUNT)).toBe(rawHash(declared));
    const preset = tree(
      "u256",
      [
        { high: "0x0", low: "0x1" },
        { high: "0x0", low: "0x2" },
      ],
      "1",
    );
    expect(typedDataHash(preset, ACCOUNT)).toBe(rawHash(preset));
    // Revision 0 has no presets, so only the declared struct is a leaf there.
    const legacy = tree("Inner", [{ leaf: "0x1" }, { leaf: "0x2" }], "0");
    expect(typedDataHash(legacy, ACCOUNT)).toBe(rawHash(legacy));
    expect(isTypedDataShape(tree("u256", [{ high: "0x0", low: "0x1" }], "0"))).toBe(false);
  });

  test("every basic leaf type is refused, on both revisions", () => {
    for (const revision of ["0", "1"] as const) {
      for (const basic of [
        "felt",
        "u128",
        "i128",
        "bool",
        "selector",
        "shortstring",
        "string",
        "timestamp",
        "ContractAddress",
        "ClassHash",
      ]) {
        expect(isTypedDataShape(tree(basic, ["0x1", "0x2"], revision))).toBe(false);
      }
      // Array, unknown, and container leaves stay refused as they already were.
      for (const bad of ["Inner*", "Ghost", "enum", "merkletree"]) {
        expect(isTypedDataShape(tree(bad, ["0x1"], revision))).toBe(false);
      }
    }
  });

  test("a variant list is not a leaf either", () => {
    const payload = envelope(
      {
        primaryType: "Message",
        types: {
          Message: [
            { contains: "Variants", name: "choice", type: "enum" },
            { contains: "Variants", name: "tree", type: "merkletree" },
          ],
          Variants: [{ name: "Some", type: "(felt)" }],
        },
      },
      { choice: { Some: ["0x1"] }, tree: [{ Some: ["0x1"] }] },
      "1",
    );
    expect(isTypedDataShape(payload)).toBe(false);
  });
});

describe("an enum variant list is disjoint from an ordinary struct", () => {
  const withTypes = (types: Record<string, Field[]>, message: unknown): unknown =>
    envelope({ primaryType: "Msg", types }, message, "1");
  const variants: Field[] = [{ name: "V1", type: "(felt)" }];

  test("the enum field and the plain reference share one encodeType", () => {
    const asEnum = withTypes(
      { Msg: [{ contains: "Variants", name: "f", type: "enum" }], Variants: variants },
      { f: { V1: ["0x5"] } },
    );
    const asStruct = withTypes({ Msg: [{ name: "f", type: "Variants" }], Variants: variants }, {});
    const encode = (payload: unknown): string =>
      snip12.encodeType((payload as { types: never }).types, "Msg", "1" as never);
    // Same type hash, different declared graphs — so only one of them may be
    // signable, or the type hash stops naming a single structure.
    expect(encode(asEnum)).toBe(encode(asStruct));
    expect(isTypedDataShape(asEnum)).toBe(true);
    expect(typedDataHash(asEnum, ACCOUNT)).toBe(rawHash(asEnum));
    expect(isTypedDataShape(asStruct)).toBe(false);
  });

  test("a variant list holds nothing but non-empty tuple payloads", () => {
    const refused: readonly Record<string, Field[]>[] = [
      { Msg: [{ contains: "Variants", name: "f", type: "enum" }], Variants: [] },
      {
        Msg: [{ contains: "Variants", name: "f", type: "enum" }],
        Variants: [{ name: "V1", type: "felt" }],
      },
      {
        Msg: [{ contains: "Variants", name: "f", type: "enum" }],
        Variants: [
          { name: "V1", type: "(felt)" },
          { name: "V2", type: "felt" },
        ],
      },
      {
        Msg: [{ contains: "Variants", name: "f", type: "enum" }],
        Variants: [{ contains: "Msg", name: "V1", type: "merkletree" }],
      },
    ];
    for (const types of refused) {
      expect(isTypedDataShape(withTypes(types, { f: { V1: ["0x5"] } }))).toBe(false);
    }
    // The all-tuple form, including the empty payload, still signs.
    const accepted = withTypes(
      {
        Msg: [{ contains: "Variants", name: "f", type: "enum" }],
        Variants: [
          { name: "V1", type: "(felt,u128)" },
          { name: "V2", type: "()" },
        ],
      },
      { f: { V1: ["0x5", "0x6"] } },
    );
    expect(typedDataHash(accepted, ACCOUNT)).toBe(rawHash(accepted));
  });

  test("a variant list is reachable only through the enum field naming it", () => {
    const enumField: Field = { contains: "Variants", name: "f", type: "enum" };
    const refused: readonly Record<string, Field[]>[] = [
      { Msg: [enumField, { name: "g", type: "Variants" }], Variants: variants },
      { Msg: [enumField, { name: "g", type: "Variants*" }], Variants: variants },
      {
        Msg: [enumField, { contains: "Variants2", name: "g", type: "enum" }],
        Variants: variants,
        Variants2: [{ name: "W", type: "(Variants)" }],
      },
    ];
    for (const types of refused) {
      expect(isTypedDataShape(withTypes(types, { f: { V1: ["0x5"] } }))).toBe(false);
    }
    // Nor as the primary type, nor as the domain struct.
    expect(
      isTypedDataShape({
        domain: { name: "MC Test", revision: "1" },
        message: { V1: ["0x5"] },
        primaryType: "Variants",
        types: {
          Msg: [{ contains: "Variants", name: "f", type: "enum" }],
          StarknetDomain: REV1_DOMAIN_TYPE,
          Variants: variants,
        },
      }),
    ).toBe(false);
    expect(
      isTypedDataShape({
        domain: { name: "MC Test", revision: "1" },
        message: {},
        primaryType: "Msg",
        types: {
          Msg: [{ contains: "StarknetDomain", name: "f", type: "enum" }],
          StarknetDomain: REV1_DOMAIN_TYPE,
        },
      }),
    ).toBe(false);
  });
});
