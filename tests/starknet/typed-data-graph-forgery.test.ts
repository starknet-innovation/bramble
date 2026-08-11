/**
 * MCW-V09-101 regression: SNIP-12 type-graph forgery.
 *
 * `encodeType` flattens a type graph into one string using `(`, `)`, `,`, `:`
 * (and `"` on revision 1) as its only separators, and neither revision escapes
 * those characters inside a type name or a field name. A name carrying a
 * separator therefore reassembles into the encoding of a *different* graph, so
 * two payloads the user reads as different structures hash identically.
 *
 * These tests pin the exact collision pair for each revision plus the name and
 * type grammar that closes both, and check that the honest half of each pair
 * still hashes — the fix is the grammar, not a ban on a revision real dapps
 * still use. Each `expect` on a collision first asserts the raw library hashes
 * really are identical, so the test would fail loudly if the underlying
 * `starknet` pin ever stopped being vulnerable and the assertion silently
 * stopped proving anything. Revision identification and the per-revision type
 * vocabularies are pinned in `typed-data-revisions.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { typedData as snip12 } from "starknet";
import { isTypedDataShape, typedDataHash } from "../../src/starknet/typed-data";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const REV1_DOMAIN = { chainId: "SN_MAIN", name: "MC Test", revision: "1", version: "1" };
const REV1_DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "version", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];

const rawHash = (payload: unknown): string =>
  snip12.getMessageHash(payload as Parameters<typeof snip12.getMessageHash>[0], ACCOUNT);

describe("SNIP-12 revision 0 type-name injection", () => {
  // The exact collision pair from the finding. Victim declares a nested
  // `Details` struct; the attacker declares no `Details` at all and instead
  // hides the whole struct definition inside the *type name* of a flat field.
  const legacyDomainType = [
    { name: "name", type: "felt" },
    { name: "chainId", type: "felt" },
    { name: "version", type: "felt" },
  ];
  const victim = {
    domain: { chainId: "SN_MAIN", name: "MC Test", version: "1" },
    message: { details: { amount: "0x3", token: "0x2" }, maker: "0x1" },
    primaryType: "Order",
    types: {
      Details: [
        { name: "token", type: "felt" },
        { name: "amount", type: "felt" },
      ],
      Order: [
        { name: "maker", type: "felt" },
        { name: "details", type: "Details" },
      ],
      StarkNetDomain: legacyDomainType,
    },
  };
  const attacker = {
    domain: { chainId: "SN_MAIN", name: "MC Test", version: "1" },
    message: {
      details: snip12.getStructHash(victim.types, "Details", victim.message.details),
      maker: "0x1",
    },
    primaryType: "Order",
    types: {
      Order: [
        { name: "maker", type: "felt" },
        { name: "details", type: "Details)Details(token:felt,amount:felt" },
      ],
      StarkNetDomain: legacyDomainType,
    },
  };

  test("the two revision 0 graphs really do collide in the pinned library", () => {
    expect(snip12.encodeType(victim.types, "Order")).toBe(
      snip12.encodeType(attacker.types, "Order"),
    );
    // Not just the type encoding: the full message hashes are byte-identical.
    expect(rawHash(victim)).toBe(rawHash(attacker));
  });

  test("the honest graph still signs and the forged one is refused", () => {
    // Revision 0 is still widely deployed, so the honest half of the collision
    // must keep hashing: the grammar, not a revision ban, is what closes this.
    expect(typedDataHash(victim, ACCOUNT)).toBe(rawHash(victim));
    expect(isTypedDataShape(attacker)).toBe(false);
    expect(() => typedDataHash(attacker, ACCOUNT)).toThrow("Invalid typed data");
  });

  test("every separator is refused in a revision 0 type name, field name, and field type", () => {
    const withTypes = (types: Record<string, unknown>): unknown => ({
      domain: { chainId: "SN_MAIN", name: "MC Test", version: "1" },
      message: { content: "hello" },
      primaryType: "Message",
      types: { StarkNetDomain: legacyDomainType, ...types },
    });
    // Baseline: the separator-free fixture signs, so every rejection below is
    // the separator's doing rather than the envelope's.
    expect(isTypedDataShape(withTypes({ Message: [{ name: "content", type: "felt" }] }))).toBe(
      true,
    );
    // `*` is excluded here: a trailing `*` is the legitimate array suffix.
    for (const separator of ['"', "(", ")", ",", ":", "\\", "\n", "‮", "é"]) {
      expect(
        isTypedDataShape(withTypes({ Message: [{ name: `content${separator}`, type: "felt" }] })),
      ).toBe(false);
      expect(
        isTypedDataShape(withTypes({ Message: [{ name: "content", type: `felt${separator}` }] })),
      ).toBe(false);
      expect(
        isTypedDataShape(
          withTypes({
            Message: [{ name: "content", type: `Inner${separator}` }],
            [`Inner${separator}`]: [{ name: "leaf", type: "felt" }],
          }),
        ),
      ).toBe(false);
    }
  });
});

describe("SNIP-12 revision 1 delimiter injection", () => {
  // Revision 1 wraps every name in quotes without escaping inner quotes, so the
  // same forgery works there — through a *field name* rather than a type name,
  // because revision 1 does reject an unresolvable field type.
  const victim = {
    domain: REV1_DOMAIN,
    message: { details: { amount: "0x3", token: "0x2" }, maker: "0x1" },
    primaryType: "Order",
    types: {
      Details: [
        { name: "token", type: "felt" },
        { name: "amount", type: "felt" },
      ],
      Order: [
        { name: "maker", type: "felt" },
        { name: "details", type: "Details" },
      ],
      StarknetDomain: REV1_DOMAIN_TYPE,
    },
  };
  const injected = 'details":"Details")"Details"("token":"felt","amount';
  const attacker = {
    domain: REV1_DOMAIN,
    message: {
      maker: "0x1",
      [injected]: snip12.getStructHash(victim.types, "Details", victim.message.details, "1"),
    },
    primaryType: "Order",
    types: {
      Order: [
        { name: "maker", type: "felt" },
        { name: injected, type: "felt" },
      ],
      StarknetDomain: REV1_DOMAIN_TYPE,
    },
  };

  test("the revision 1 field-name forgery really does collide too", () => {
    expect(snip12.encodeType(victim.types, "Order", "1")).toBe(
      snip12.encodeType(attacker.types, "Order", "1"),
    );
    expect(rawHash(victim)).toBe(rawHash(attacker));
  });

  test("the honest graph still signs and the forged one is refused", () => {
    expect(typedDataHash(victim, ACCOUNT)).toBe(rawHash(victim));
    expect(isTypedDataShape(attacker)).toBe(false);
    expect(() => typedDataHash(attacker, ACCOUNT)).toThrow("Invalid typed data");
  });

  test("every separator is refused in a type name, a field name, and a field type", () => {
    const withTypes = (types: Record<string, unknown>): unknown => ({
      domain: REV1_DOMAIN,
      message: { content: "hello" },
      primaryType: "Message",
      types: { StarknetDomain: REV1_DOMAIN_TYPE, ...types },
    });
    // `*` is excluded here: a trailing `*` is the legitimate array suffix, and
    // is pinned separately below.
    for (const separator of ['"', "(", ")", ",", ":", "\\", "\n", "‮", "é"]) {
      expect(
        isTypedDataShape(withTypes({ Message: [{ name: `content${separator}`, type: "felt" }] })),
      ).toBe(false);
      expect(
        isTypedDataShape(withTypes({ Message: [{ name: "content", type: `felt${separator}` }] })),
      ).toBe(false);
      expect(
        isTypedDataShape(
          withTypes({
            Message: [{ name: "content", type: `Inner${separator}` }],
            [`Inner${separator}`]: [{ name: "leaf", type: "felt" }],
          }),
        ),
      ).toBe(false);
    }
  });

  test("the array suffix is accepted only as a single trailing star", () => {
    // The message holds a real array, because a `felt*` field whose value is not
    // one is refused on its value rather than on its type spelling, and this
    // test is about the spelling.
    const withMessage = (fields: readonly unknown[]): unknown => ({
      domain: REV1_DOMAIN,
      message: { content: ["0x1", "0x2"] },
      primaryType: "Message",
      types: { Message: fields, StarknetDomain: REV1_DOMAIN_TYPE },
    });
    expect(isTypedDataShape(withMessage([{ name: "content", type: "felt*" }]))).toBe(true);
    for (const type of ["felt**", "*felt", "*", "fe*lt"]) {
      expect(isTypedDataShape(withMessage([{ name: "content", type }]))).toBe(false);
    }
    // An array of a container type has no `ctx` to resolve `contains` against
    // and crashes the encoder, so it is refused rather than hashed.
    expect(
      isTypedDataShape(withMessage([{ name: "content", contains: "Message", type: "enum*" }])),
    ).toBe(false);
  });
});

describe("type graph resolution", () => {
  const withTypes = (types: Record<string, unknown>, primaryType = "Message"): unknown => ({
    domain: REV1_DOMAIN,
    message: { content: "hello" },
    primaryType,
    types: { StarknetDomain: REV1_DOMAIN_TYPE, ...types },
  });

  test("accepts the full revision 1 vocabulary", () => {
    const u256 = { high: "0x0", low: "0x1" };
    expect(
      isTypedDataShape({
        domain: REV1_DOMAIN,
        // Values are part of what is accepted, so the whole vocabulary is
        // exercised with a message that actually holds the declared shape.
        message: {
          amount: u256,
          asset: { amount: u256, token_address: "0x2" },
          choice: { Nothing: [] },
          content: "0x1",
          many: [{ leaf: "0x5" }],
          nft: { collection_address: "0x3", token_id: u256 },
          tree: [{ leaf: "0x6" }],
          who: "0x4",
        },
        primaryType: "Message",
        types: {
          StarknetDomain: REV1_DOMAIN_TYPE,
          Inner: [{ name: "leaf", type: "felt" }],
          Message: [
            { name: "content", type: "felt" },
            { name: "amount", type: "u256" },
            { name: "asset", type: "TokenAmount" },
            { name: "nft", type: "NftId" },
            { name: "who", type: "ContractAddress" },
            { name: "many", type: "Inner*" },
            { name: "choice", contains: "Choice", type: "enum" },
            { name: "tree", contains: "Inner", type: "merkletree" },
          ],
          Choice: [
            { name: "Nothing", type: "()" },
            { name: "Some", type: "(felt,u128)" },
          ],
        },
      }),
    ).toBe(true);
  });

  test("a rich revision 1 payload still hashes, so the guard is not over-tight", () => {
    // The guard has to reject forgeries without rejecting honest structure:
    // presets, arrays, nested structs and enum variants all still reach a hash.
    const payload = {
      domain: REV1_DOMAIN,
      message: {
        amount: { high: "0x0", low: "0x64" },
        choice: { Some: ["0x1", "0x2"] },
        items: [{ leaf: "0x1" }, { leaf: "0x2" }],
        who: "0x5",
      },
      primaryType: "Order",
      types: {
        Choice: [
          { name: "Nothing", type: "()" },
          { name: "Some", type: "(felt,u128)" },
        ],
        Inner: [{ name: "leaf", type: "felt" }],
        Order: [
          { name: "amount", type: "u256" },
          { name: "who", type: "ContractAddress" },
          { name: "items", type: "Inner*" },
          { name: "choice", contains: "Choice", type: "enum" },
        ],
        StarknetDomain: REV1_DOMAIN_TYPE,
      },
    };
    expect(typedDataHash(payload, ACCOUNT)).toBe(rawHash(payload));
  });

  test("a field name containing spaces is still accepted", () => {
    // Session-style payloads use names like "Session Key"; a space cannot
    // reassemble `encodeType`, so refusing it would break honest dapps.
    const payload = {
      domain: REV1_DOMAIN,
      message: { "Allowed Method": "transfer", "Session Key": "0x9" },
      primaryType: "Session",
      types: {
        Session: [
          { name: "Allowed Method", type: "shortstring" },
          { name: "Session Key", type: "felt" },
        ],
        StarknetDomain: REV1_DOMAIN_TYPE,
      },
    };
    expect(typedDataHash(payload, ACCOUNT)).toBe(rawHash(payload));
  });

  test("rejects an unresolvable field type instead of coercing it to a felt", () => {
    expect(isTypedDataShape(withTypes({ Message: [{ name: "content", type: "Ghost" }] }))).toBe(
      false,
    );
    expect(isTypedDataShape(withTypes({ Message: [{ name: "content", type: "Ghost*" }] }))).toBe(
      false,
    );
    expect(isTypedDataShape(withTypes({ Message: [{ name: "c", type: "(felt,Ghost)" }] }))).toBe(
      false,
    );
  });

  test("rejects a container field whose contains does not resolve", () => {
    expect(
      isTypedDataShape(withTypes({ Message: [{ name: "c", contains: "Ghost", type: "enum" }] })),
    ).toBe(false);
    // `contains` is only meaningful for enum/merkletree; elsewhere it is a
    // field the user never sees explained.
    expect(
      isTypedDataShape(withTypes({ Message: [{ name: "c", contains: "Message", type: "felt" }] })),
    ).toBe(false);
  });

  test("rejects redeclaring a reserved or preset type name", () => {
    // `encodeType` resolves a preset from the library while `encodeValue`
    // prefers the declaration, so the type hash would describe a shape the
    // value hash never used.
    for (const reserved of ["u256", "TokenAmount", "NftId", "felt", "enum", "merkletree"]) {
      expect(
        isTypedDataShape(
          withTypes({ Message: [{ name: "content", type: "felt" }], [reserved]: [] }),
        ),
      ).toBe(false);
    }
  });

  test("the legacy domain name is an ordinary struct, so back-compat payloads pass", () => {
    // The payload declares revision 1, so `StarkNetDomain` never reaches the
    // domain hash and a payload declaring both spellings is the common
    // back-compat shape, not an attack. Pinned by hash equality, not inspection.
    const withLegacy = {
      domain: REV1_DOMAIN,
      message: { content: "hello" },
      primaryType: "Message",
      types: {
        Message: [{ name: "content", type: "felt" }],
        StarkNetDomain: [{ name: "name", type: "felt" }],
        StarknetDomain: REV1_DOMAIN_TYPE,
      },
    };
    const withoutLegacy = {
      ...withLegacy,
      types: { Message: withLegacy.types.Message, StarknetDomain: REV1_DOMAIN_TYPE },
    };
    expect(isTypedDataShape(withLegacy)).toBe(true);
    expect(typedDataHash(withLegacy, ACCOUNT)).toBe(rawHash(withoutLegacy));
  });

  test("a merkletree leaf must be a struct, not a raw felt", () => {
    // `contains` never enters `encodeType`, so only the leaf *values* can bind
    // the declared leaf shape. A struct or preset leaf hashes as
    // `H(typeHash, …values)`; a basic leaf is the felt the site typed in, which
    // is the substitution `typed-data-injectivity.test.ts` pins as a forgery.
    const tree = (contains: string, leaves: readonly unknown[]): unknown => ({
      domain: REV1_DOMAIN,
      message: { tree: leaves },
      primaryType: "Message",
      types: {
        Inner: [{ name: "leaf", type: "felt" }],
        Message: [{ name: "tree", contains, type: "merkletree" }],
        StarknetDomain: REV1_DOMAIN_TYPE,
      },
    });
    for (const [contains, leaves] of [
      [
        "u256",
        [
          { high: "0x0", low: "0x1" },
          { high: "0x0", low: "0x2" },
        ],
      ],
      ["Inner", [{ leaf: "0x1" }, { leaf: "0x2" }]],
    ] as const) {
      const payload = tree(contains, leaves);
      expect(isTypedDataShape(payload)).toBe(true);
      expect(typedDataHash(payload, ACCOUNT)).toBe(rawHash(payload));
    }
    expect(isTypedDataShape(tree("felt", ["0x1", "0x2", "0x3"]))).toBe(false);
    // An array leaf and an unresolvable leaf were already refused: the library
    // throws on both, so they fail closed at the shape check.
    expect(isTypedDataShape(tree("Inner*", [[{ leaf: "0x1" }]]))).toBe(false);
    expect(isTypedDataShape(tree("Ghost", ["0x1"]))).toBe(false);
    expect(isTypedDataShape(tree("enum", ["0x1"]))).toBe(false);
  });

  test("an enum still requires a declared variant struct in contains", () => {
    // `encodeValue` indexes `types[contains]` directly, so a basic-type
    // `contains` crashes the encoder; refuse it rather than hash-or-throw.
    expect(
      isTypedDataShape(withTypes({ Message: [{ name: "c", contains: "felt", type: "enum" }] })),
    ).toBe(false);
    expect(
      isTypedDataShape(withTypes({ Message: [{ name: "c", contains: "u256", type: "enum" }] })),
    ).toBe(false);
  });

  test("rejects an undeclared primary type and duplicate field names", () => {
    expect(isTypedDataShape(withTypes({ Message: [] }, "Missing"))).toBe(false);
    expect(
      isTypedDataShape(
        withTypes({
          Message: [
            { name: "content", type: "felt" },
            { name: "content", type: "u128" },
          ],
        }),
      ),
    ).toBe(false);
  });

  test("rejects a malformed field entry", () => {
    expect(isTypedDataShape(withTypes({ Message: [{ name: "content" }] }))).toBe(false);
    expect(isTypedDataShape(withTypes({ Message: [{ type: "felt" }] }))).toBe(false);
    expect(
      isTypedDataShape(withTypes({ Message: [{ extra: 1, name: "content", type: "felt" }] })),
    ).toBe(false);
    expect(isTypedDataShape(withTypes({ Message: "not-a-list" }))).toBe(false);
  });
});

describe("domain keys are bound to the domain type", () => {
  test("an undeclared domain key is refused rather than silently unhashed", () => {
    const domainType = [
      { name: "name", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "revision", type: "shortstring" },
    ];
    const payload = (chainId: string): unknown => ({
      domain: { chainId, name: "MC Test", revision: "1", version: "1" },
      message: { content: "hello" },
      primaryType: "Message",
      types: { Message: [{ name: "content", type: "felt" }], StarknetDomain: domainType },
    });
    // The library hashes SN_MAIN and SN_SEPOLIA identically, because neither
    // reaches the domain struct: `chainId` is not a declared domain field.
    expect(rawHash(payload("SN_MAIN"))).toBe(rawHash(payload("SN_SEPOLIA")));
    expect(isTypedDataShape(payload("SN_MAIN"))).toBe(false);
    expect(() => typedDataHash(payload("SN_SEPOLIA"), ACCOUNT)).toThrow("Invalid typed data");
  });

  test("a domain type may omit revision, since revision selects the hash method", () => {
    expect(
      isTypedDataShape({
        domain: { name: "MC Test", revision: "1", version: "1" },
        message: { content: "hello" },
        primaryType: "Message",
        types: {
          Message: [{ name: "content", type: "felt" }],
          StarknetDomain: [
            { name: "name", type: "shortstring" },
            { name: "version", type: "shortstring" },
          ],
        },
      }),
    ).toBe(true);
  });

  test("a missing StarknetDomain declaration is refused", () => {
    expect(
      isTypedDataShape({
        domain: REV1_DOMAIN,
        message: { content: "hello" },
        primaryType: "Message",
        types: { Message: [{ name: "content", type: "felt" }] },
      }),
    ).toBe(false);
  });
});
