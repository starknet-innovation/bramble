/**
 * MCW-V09-104, gate half: a payload this wallet hashes must hold the shape its
 * own declarations describe, because the pinned library reads values with plain
 * JavaScript indexing and will otherwise hash something the payload never said.
 *
 * Each case below is a payload whose *type graph* is unambiguous — the whole of
 * MCW-V09-101's grammar accepts it — and whose *value* still made the library
 * hash, or hang on, something the approval card could not describe:
 *
 *  - `{leaves: []}` under a `merkletree` field: `new MerkleTree([])` recurses
 *    `build([]) -> build([])` with no base case, and under Bun/JSC's proper tail
 *    calls that is an infinite loop rather than a stack overflow. Because
 *    `chain-ops.handleSignTypedData` hashes *before* enqueueing an approval, one
 *    `wallet_signTypedData` from a connected dapp wedged the service worker. The
 *    test asserts the gate refuses it, which is why it can be written at all:
 *    `typedDataHash` short-circuits on `isTypedDataShape` and never reaches the
 *    library, so nothing here can hang.
 *  - `{Pay: "SN_MAIN"}` under a `(felt)` variant: `variantData[index]` indexes a
 *    string, so the letter `S` was hashed while the card refused to classify it.
 *  - a field named `constructor` over an empty message: `data[field.name]` walks
 *    the prototype chain and hashed `Object.prototype.constructor`.
 *  - a variant payload longer or shorter than its declared tuple: the extra
 *    elements are never read, so two different payloads reach one hash.
 *
 * Each test pairs the refusal with a near-identical payload that is still
 * accepted, so a future change that simply refused everything would fail here.
 */
import { describe, expect, test } from "bun:test";
import { isTypedDataShape, typedDataHash } from "@bramble/starknet/typed-data";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const DOMAIN = { chainId: "SN_SEPOLIA", name: "App", revision: "1" };
const DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];

const envelope = (message: unknown, types: Record<string, unknown>): unknown => ({
  domain: DOMAIN,
  message,
  primaryType: "Msg",
  types: { ...types, StarknetDomain: DOMAIN_TYPE },
});

describe("a merkle field must carry leaves", () => {
  const types = {
    Leaf: [{ name: "a", type: "felt" }],
    Msg: [{ contains: "Leaf", name: "leaves", type: "merkletree" }],
  };

  test("an empty leaf list is refused before it reaches the library", () => {
    // Never call the library on this payload: it does not terminate.
    expect(isTypedDataShape(envelope({ leaves: [] }, types))).toBe(false);
    expect(() => typedDataHash(envelope({ leaves: [] }, types), ACCOUNT)).toThrow(
      "Invalid typed data",
    );
    // One leaf is the smallest tree the library can build, and it still signs.
    expect(typedDataHash(envelope({ leaves: [{ a: "0x1" }] }, types), ACCOUNT)).toMatch(
      /^0x[0-9a-f]+$/,
    );
  });

  test("a merkle value that is not an array is refused too", () => {
    for (const leaves of ["0x1", { 0: { a: "0x1" } }, null, 3]) {
      expect(isTypedDataShape(envelope({ leaves }, types))).toBe(false);
    }
  });
});

describe("an enum variant payload must be its declared tuple", () => {
  const types = {
    Action: [
      { name: "Pay", type: "(felt)" },
      { name: "Nothing", type: "()" },
    ],
    Msg: [{ contains: "Action", name: "action", type: "enum" }],
  };
  const action = (value: unknown): unknown => envelope({ action: value }, types);

  test("an indexable non-array payload is refused, not hashed character by character", () => {
    expect(isTypedDataShape(action({ Pay: "SN_MAIN" }))).toBe(false);
    expect(isTypedDataShape(action({ Pay: { 0: "1", note: "you are safe" } }))).toBe(false);
    expect(typedDataHash(action({ Pay: ["1"] }), ACCOUNT)).toMatch(/^0x[0-9a-f]+$/);
  });

  test("a payload longer or shorter than the declared tuple is refused", () => {
    expect(isTypedDataShape(action({ Pay: ["1", "SN_MAIN"] }))).toBe(false);
    expect(isTypedDataShape(action({ Pay: [] }))).toBe(false);
    // The empty tuple takes an empty array and nothing else, which is what made
    // a `()` variant's payload pure decoration in the first place.
    expect(typedDataHash(action({ Nothing: [] }), ACCOUNT)).toMatch(/^0x[0-9a-f]+$/);
    expect(isTypedDataShape(action({ Nothing: ["Approve 1 STRK for swap"] }))).toBe(false);
  });

  test("a second variant, or an undeclared one, is refused", () => {
    expect(isTypedDataShape(action({ Nothing: [], Pay: ["1"] }))).toBe(false);
    expect(isTypedDataShape(action({ Withdraw: ["everything"] }))).toBe(false);
    expect(isTypedDataShape(action({}))).toBe(false);
  });
});

describe("declared fields are read as own properties", () => {
  test("a field named after a prototype member is refused, not hashed off the prototype", () => {
    const types = {
      Foo: [{ name: "name", type: "shortstring" }],
      Msg: [{ name: "constructor", type: "Foo" }],
    };
    // `data["constructor"]` resolves through the prototype chain to a function,
    // which the library hashed while the card could describe none of it.
    expect(isTypedDataShape(envelope({}, types))).toBe(false);
    // Supplied as a real own property, the very same graph still signs.
    expect(typedDataHash(envelope({ constructor: { name: "ok" } }, types), ACCOUNT)).toMatch(
      /^0x[0-9a-f]+$/,
    );
  });

  test("a declared field the message omits is refused", () => {
    const types = { Msg: [{ name: "amount", type: "felt" }] };
    expect(isTypedDataShape(envelope({}, types))).toBe(false);
    expect(isTypedDataShape(envelope({ other: "1" }, types))).toBe(false);
    // Undeclared keys beside a present declared field stay accepted: the sign
    // card is required to show them in its not-signed block, not to have them
    // refused here.
    expect(typedDataHash(envelope({ amount: "1", other: "1" }, types), ACCOUNT)).toMatch(
      /^0x[0-9a-f]+$/,
    );
  });

  test("a leaf type may not hold an object, and a struct type may not hold a scalar", () => {
    expect(
      isTypedDataShape(envelope({ amount: { a: 1 } }, { Msg: [{ name: "amount", type: "felt" }] })),
    ).toBe(false);
    expect(
      isTypedDataShape(
        envelope(
          { details: "1000 USDC" },
          {
            Details: [{ name: "amount", type: "u128" }],
            Msg: [{ name: "details", type: "Details" }],
          },
        ),
      ),
    ).toBe(false);
  });
});

describe("a field name may not carry the card's path separator", () => {
  test("a dotted field name is refused, so a flat field cannot imitate a nested one", () => {
    // The approval card joins nested paths with `.`, so a field literally named
    // `to.address` would render byte-identically to a `to` struct holding an
    // `address` — two different signable structures, one review surface.
    const flat = envelope(
      { amount: "5", "to.address": "0x1111" },
      {
        Msg: [
          { name: "to.address", type: "ContractAddress" },
          { name: "amount", type: "u128" },
        ],
      },
    );
    const nested = envelope(
      { amount: "5", to: { address: "0x1111" } },
      {
        Msg: [
          { name: "to", type: "Recipient" },
          { name: "amount", type: "u128" },
        ],
        Recipient: [{ name: "address", type: "ContractAddress" }],
      },
    );
    expect(isTypedDataShape(flat)).toBe(false);
    expect(typedDataHash(nested, ACCOUNT)).toMatch(/^0x[0-9a-f]+$/);
    // A dotted *type* name is refused for the same reason.
    expect(
      isTypedDataShape(
        envelope(
          { to: { address: "0x1" } },
          {
            "Re.cipient": [{ name: "address", type: "felt" }],
            Msg: [{ name: "to", type: "Re.cipient" }],
          },
        ),
      ),
    ).toBe(false);
    // Spaces, hyphens and underscores remain legal: they are not path
    // separators, and session-style payloads use names like "Session Key".
    expect(
      typedDataHash(
        envelope({ "Session Key": "0x9" }, { Msg: [{ name: "Session Key", type: "felt" }] }),
        ACCOUNT,
      ),
    ).toMatch(/^0x[0-9a-f]+$/);
  });
});
