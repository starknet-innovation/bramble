/**
 * MCW-V09-101, compatibility half: both SNIP-12 revisions must be signable and
 * both must be safe.
 *
 * The forgery in `typed-data-graph-forgery.test.ts` is closed by a name grammar
 * that admits no `encodeType` separator, not by refusing a revision. These
 * tests pin the two halves that makes possible:
 *
 * 1. Revision identification matches the pinned library's own `identifyRevision`
 *    exactly — same spellings, same precedence, same tolerance of a numeric `1`
 *    and same refusal of a numeric `0` — so the wallet never refuses a payload
 *    the account would have signed, and never accepts one the library then
 *    cannot hash.
 * 2. Each revision is validated against its own vocabulary. Revision 0 has no
 *    presets, no enums and no tuples, and coerces anything it cannot resolve to
 *    a felt, which is the primitive the forgery is built from.
 *
 * The differential search that proves the grammar buys injectivity across both
 * revisions lives in `typed-data-injectivity.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { snip12Vocabulary } from "@bramble/starknet/snip12-vocabulary";
import { isTypedDataShape, typedDataHash } from "@bramble/starknet/typed-data";
import { typedData as snip12 } from "starknet";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const LEGACY_DOMAIN_TYPE = [
  { name: "name", type: "felt" },
  { name: "version", type: "felt" },
  { name: "chainId", type: "felt" },
];
const ACTIVE_DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "version", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
];

const rawHash = (payload: unknown): string =>
  snip12.getMessageHash(payload as Parameters<typeof snip12.getMessageHash>[0], ACCOUNT);

// A revision 0 envelope: legacy domain spelling, no `revision` key by default.
const legacy = (
  types: Record<string, unknown>,
  message: unknown,
  primaryType = "Message",
): unknown => ({
  domain: { chainId: "SN_MAIN", name: "MC Test", version: "1" },
  message,
  primaryType,
  types: { StarkNetDomain: LEGACY_DOMAIN_TYPE, ...types },
});

describe("SNIP-12 revision identification", () => {
  const message = { content: "hello" };
  const messageType = { Message: [{ name: "content", type: "felt" }] };
  const envelope = (types: Record<string, unknown>, revision?: unknown): unknown => ({
    domain:
      revision === undefined
        ? { chainId: "SN_MAIN", name: "MC Test", version: "1" }
        : { chainId: "SN_MAIN", name: "MC Test", revision, version: "1" },
    message,
    primaryType: "Message",
    types: { ...messageType, ...types },
  });
  const active = { StarknetDomain: ACTIVE_DOMAIN_TYPE };
  const legacyDomain = { StarkNetDomain: LEGACY_DOMAIN_TYPE };

  // Every case the pinned library identifies, and every case it does not. The
  // library is consulted directly so this stays true if the pin ever moves.
  const librarySigns = (payload: unknown): boolean => {
    try {
      rawHash(payload);
      return true;
    } catch {
      return false;
    }
  };

  test("acceptance matches the library case for case", () => {
    const cases: readonly (readonly [string, unknown])[] = [
      ["revision 1 as a string", envelope(active, "1")],
      ["revision 1 as a number", envelope(active, 1)],
      ["revision 1 with no revision key", envelope(active)],
      ["revision 1 spelling with revision 0", envelope(active, "0")],
      ["revision 0 with no revision key", envelope(legacyDomain)],
      ["revision 0 as a string", envelope(legacyDomain, "0")],
      ["revision 0 as a number", envelope(legacyDomain, 0)],
      ["revision 0 spelling with revision 1", envelope(legacyDomain, "1")],
      ["both spellings, revision 1", envelope({ ...active, ...legacyDomain }, "1")],
      ["both spellings, revision 0", envelope({ ...active, ...legacyDomain }, "0")],
      ["both spellings, no revision key", envelope({ ...active, ...legacyDomain })],
      ["no domain type at all", envelope({})],
    ];
    for (const [label, payload] of cases) {
      expect(`${label}: ${isTypedDataShape(payload)}`).toBe(`${label}: ${librarySigns(payload)}`);
    }
  });

  test("a numeric revision 1 hashes identically to the string form", () => {
    // The library compares `domain.revision?.toString()`, so refusing the
    // numeric form would refuse a payload the account signs bit for bit.
    const numeric = envelope(active, 1);
    expect(typedDataHash(numeric, ACCOUNT)).toBe(typedDataHash(envelope(active, "1"), ACCOUNT));
    expect(typedDataHash(numeric, ACCOUNT)).toBe(rawHash(numeric));
  });

  test("a revision that is neither identifies nothing", () => {
    for (const revision of [[1], "01", "1.0", true, null, "2"]) {
      expect(isTypedDataShape(envelope({ ...active, ...legacyDomain }, revision))).toBe(false);
    }
  });

  test("the reported vocabulary follows the same rules", () => {
    expect(snip12Vocabulary(envelope(active, 1))).toMatchObject({
      domainType: "StarknetDomain",
      revision: "1",
    });
    expect(snip12Vocabulary(envelope(legacyDomain))).toMatchObject({
      domainType: "StarkNetDomain",
      revision: "0",
    });
    expect(snip12Vocabulary(envelope(legacyDomain, 0))).toMatchObject({
      domainType: null,
      revision: null,
    });
    expect(snip12Vocabulary("not typed data")).toMatchObject({ domainType: null, revision: null });
    // Revision 0 has no presets, so a reader must not decompose `u256`.
    expect(snip12Vocabulary(envelope(legacyDomain)).presetFields.size).toBe(0);
    expect(snip12Vocabulary(envelope(active, "1")).presetFields.get("u256")).toEqual([
      { name: "low", type: "u128" },
      { name: "high", type: "u128" },
    ]);
  });
});

describe("SNIP-12 revision 0 vocabulary", () => {
  test("a benign revision 0 payload signs, and matches the library hash", () => {
    const payload = legacy(
      {
        Details: [
          { name: "token", type: "felt" },
          { name: "amount", type: "felt" },
        ],
        Order: [
          { name: "maker", type: "felt" },
          { name: "memo", type: "shortstring" },
          { name: "details", type: "Details" },
          { name: "extras", type: "Details*" },
        ],
      },
      {
        details: { amount: "0x3", token: "0x2" },
        extras: [{ amount: "0x5", token: "0x4" }],
        maker: "0x1",
        memo: "hello",
      },
      "Order",
    );
    expect(isTypedDataShape(payload)).toBe(true);
    expect(typedDataHash(payload, ACCOUNT)).toBe(rawHash(payload));
  });

  test("a merkletree still resolves, because revision 0 encodes its leaves", () => {
    const payload = legacy(
      {
        Inner: [{ name: "leaf", type: "felt" }],
        Message: [{ name: "tree", contains: "Inner", type: "merkletree" }],
      },
      { tree: [{ leaf: "0x1" }, { leaf: "0x2" }] },
    );
    expect(typedDataHash(payload, ACCOUNT)).toBe(rawHash(payload));
  });

  test("constructs revision 0 cannot encode are refused, not coerced to a felt", () => {
    // `encodeValue` has no preset table on revision 0 and its `getDependencies`
    // never walks an enum's `contains` or a tuple, so each of these would hash
    // something other than the structure the card renders.
    const refused: readonly Record<string, unknown>[] = [
      { Message: [{ name: "amount", type: "u256" }] },
      { Message: [{ name: "asset", type: "TokenAmount" }] },
      { Message: [{ name: "nft", type: "NftId" }] },
      {
        Choice: [{ name: "Some", type: "(felt)" }],
        Message: [{ name: "c", contains: "Choice", type: "enum" }],
      },
      { Message: [{ name: "c", type: "(felt,felt)" }] },
      { Message: [{ name: "c", type: "Ghost" }] },
    ];
    for (const types of refused) {
      expect(isTypedDataShape(legacy(types, { amount: "0x1" }))).toBe(false);
    }
  });

  test("a preset name is an ordinary struct on revision 0 and reserved on revision 1", () => {
    // Revision 0 predates presets: `u256` there is whatever the payload says it
    // is, and both `encodeType` and `encodeValue` read it from the declaration.
    const declared = {
      u256: [
        { name: "low", type: "felt" },
        { name: "high", type: "felt" },
      ],
    };
    const payload = legacy(
      { ...declared, Message: [{ name: "amount", type: "u256" }] },
      { amount: { high: "0x0", low: "0x64" } },
    );
    expect(typedDataHash(payload, ACCOUNT)).toBe(rawHash(payload));
    // On revision 1 the same declaration is refused: `encodeType` would take
    // the library preset while `encodeValue` took the declaration.
    expect(
      isTypedDataShape({
        domain: { chainId: "SN_MAIN", name: "MC Test", revision: "1", version: "1" },
        message: { amount: { high: "0x0", low: "0x64" } },
        primaryType: "Message",
        types: {
          ...declared,
          Message: [{ name: "amount", type: "u256" }],
          StarknetDomain: ACTIVE_DOMAIN_TYPE,
        },
      }),
    ).toBe(false);
  });

  test("an undeclared revision 0 domain key is refused, as on revision 1", () => {
    const payload = legacy({ Message: [{ name: "content", type: "felt" }] }, { content: "0x1" });
    const trimmed = {
      ...(payload as Record<string, unknown>),
      types: {
        Message: [{ name: "content", type: "felt" }],
        StarkNetDomain: [{ name: "name", type: "felt" }],
      },
    };
    // `chainId` and `version` reach no hash once the domain type drops them.
    expect(rawHash(trimmed)).toBe(
      rawHash({ ...trimmed, domain: { chainId: "SN_SEPOLIA", name: "MC Test", version: "9" } }),
    );
    expect(isTypedDataShape(trimmed)).toBe(false);
  });
});
