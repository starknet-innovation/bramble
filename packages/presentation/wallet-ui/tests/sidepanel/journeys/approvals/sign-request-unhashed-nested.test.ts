/**
 * MCW-V09-104 regression, nested half: the sign card must not present unhashed
 * values as part of the signature at *any* depth.
 *
 * SNIP-12 `encodeData` walks a struct's declared field list and ignores every
 * other key of the value, `encodeValue` hashes only `Object.entries(value)[0]`
 * of an enum, and both rules apply inside nested structs, array elements, and
 * library presets. Rendering a nested value verbatim therefore let a site show
 * `chainId: SN_SEPOLIA` or a second "Drain" variant as message content that the
 * signature does not commit to.
 *
 * Every test here first asserts the collision is real — the two payloads hash
 * byte-identically through `typedDataHash` — so it would fail loudly rather
 * than silently stop proving anything if the pinned library ever changed. It
 * then asserts the renderer gives both payloads the *same* signed rows and
 * carries the difference only in the not-signed block.
 */
import { describe, expect, test } from "bun:test";
import { isTypedDataShape, typedDataHash } from "@bramble/starknet/typed-data";
import { typedData as snip12 } from "starknet";
import { signRequestView } from "../../../../src/sidepanel/shared/sign-request";
import {
  SIGNED_MESSAGE_LABEL,
  signBlockBody,
  signHtml,
  UNSIGNED_MESSAGE_LABEL as UNSIGNED_LABEL,
} from "../../../support/sign-request-blocks";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

// The pinned library's own hash, used where the wallet now refuses a payload at
// the gate but the collision it would otherwise have signed still has to be
// shown to be real.
const rawHash = (payload: unknown): string =>
  snip12.getMessageHash(payload as Parameters<typeof snip12.getMessageHash>[0], ACCOUNT);

const DOMAIN = { chainId: "SN_MAIN", name: "MC Test", revision: "1", version: "1" };
const DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "version", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];

// Asserts the two payloads are indistinguishable to the account that signs
// them, then hands back both renderings.
const bothRenderings = (honest: unknown, padded: unknown): readonly [string, string] => {
  expect(typedDataHash(padded, ACCOUNT)).toBe(typedDataHash(honest, ACCOUNT));
  return [signHtml(honest), signHtml(padded)];
};

describe("sign card nested message values", () => {
  test("keys a nested struct never declares are split out, not shown as message content", () => {
    // The finding's live exploit: `Details` declares only `amount`, so a
    // `chainId` and a `recipient` smuggled into the nested value are pure
    // decoration — the hash is identical without them.
    const order = (details: Record<string, unknown>): unknown => ({
      domain: DOMAIN,
      message: { details },
      primaryType: "Order",
      types: {
        Details: [{ name: "amount", type: "u128" }],
        Order: [{ name: "details", type: "Details" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });

    const [honest, padded] = bothRenderings(
      order({ amount: "1" }),
      order({ amount: "1", chainId: "SN_SEPOLIA", recipient: "0xSAFE_TREASURY" }),
    );

    // Identical signed message rows for two payloads that sign identically.
    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).toBe(
      signBlockBody(honest, SIGNED_MESSAGE_LABEL) as string,
    );
    const signed = signBlockBody(padded, SIGNED_MESSAGE_LABEL);
    expect(signed).toContain("details.amount");
    expect(signed).not.toContain("SN_SEPOLIA");
    expect(signed).not.toContain("SAFE_TREASURY");

    const unsigned = signBlockBody(padded, UNSIGNED_LABEL);
    expect(unsigned).toContain("details.chainId");
    expect(unsigned).toContain("SN_SEPOLIA");
    expect(unsigned).toContain("details.recipient");
    expect(unsigned).toContain("SAFE_TREASURY");
    // The honest payload has nothing unsigned at all.
    expect(honest).not.toContain(UNSIGNED_LABEL);
  });

  test("keys an array element never declares are split out too", () => {
    const order = (items: readonly unknown[]): unknown => ({
      domain: DOMAIN,
      message: { items },
      primaryType: "Order",
      types: {
        Inner: [{ name: "leaf", type: "felt" }],
        Order: [{ name: "items", type: "Inner*" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });

    const [honest, padded] = bothRenderings(
      order([{ leaf: "0x1" }, { leaf: "0x2" }]),
      order([{ leaf: "0x1", note: "NOT SIGNED but shown" }, { leaf: "0x2" }]),
    );

    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).toBe(
      signBlockBody(honest, SIGNED_MESSAGE_LABEL) as string,
    );
    // Each element is addressed by index, so the user can see which one.
    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).toContain("items[0].leaf");
    expect(signBlockBody(padded, UNSIGNED_LABEL)).toContain("items[0].note");
    expect(signBlockBody(padded, UNSIGNED_LABEL)).toContain("NOT SIGNED but shown");
    expect(honest).not.toContain(UNSIGNED_LABEL);
  });

  test("only the first enum variant is signed, so the rest are split out", () => {
    // `encodeValue` takes `Object.entries(data)[0]`; a second variant packed
    // into the same value is never hashed but used to render as content.
    const order = (choice: Record<string, unknown>): unknown => ({
      domain: DOMAIN,
      message: { choice },
      primaryType: "Order",
      types: {
        Choice: [
          { name: "Safe", type: "()" },
          { name: "Drain", type: "()" },
        ],
        Order: [{ name: "choice", contains: "Choice", type: "enum" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });

    // Insertion order is the whole point here, so build it explicitly rather
    // than relying on how an object literal happens to be written.
    const variants = (...names: readonly string[]): Record<string, unknown> =>
      Object.fromEntries(names.map((name) => [name, []]));
    const honestPayload = order(variants("Safe"));
    const paddedPayload = order(variants("Safe", "Drain"));
    // The collision is real — the pinned library hashes both identically — but
    // the wallet now refuses the padded spelling at the gate rather than hashing
    // a value carrying a variant the signature never covers. The renderer still
    // has to split it, because it renders payloads the gate refuses.
    expect(rawHash(paddedPayload)).toBe(rawHash(honestPayload));
    expect(typedDataHash(honestPayload, ACCOUNT)).toBe(rawHash(honestPayload));
    expect(isTypedDataShape(paddedPayload)).toBe(false);
    const honest = signHtml(honestPayload);
    const padded = signHtml(paddedPayload);

    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).toBe(
      signBlockBody(honest, SIGNED_MESSAGE_LABEL) as string,
    );
    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).toContain("choice.Safe");
    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).not.toContain("Drain");
    expect(signBlockBody(padded, UNSIGNED_LABEL)).toContain("choice.Drain");
  });

  test("a declared enum variant payload is decoded per tuple element", () => {
    const payload = {
      domain: DOMAIN,
      message: { choice: { Some: ["0x1", "0x2"] } },
      primaryType: "Order",
      types: {
        Choice: [
          { name: "Nothing", type: "()" },
          { name: "Some", type: "(felt,u128)" },
        ],
        Order: [{ name: "choice", contains: "Choice", type: "enum" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    };
    // Sanity: this is an honest payload the wallet will actually hash.
    expect(typedDataHash(payload, ACCOUNT)).toMatch(/^0x[0-9a-f]+$/);

    const signed = signBlockBody(signHtml(payload), SIGNED_MESSAGE_LABEL);
    expect(signed).toContain("choice.Some[0]");
    expect(signed).toContain("choice.Some[1]");
    expect(signHtml(payload)).not.toContain(UNSIGNED_LABEL);
  });

  test("keys a library preset never declares are split out as well", () => {
    // `u256` is resolved from the library's preset list, not from `types`, so
    // the renderer has to know its field list to spot an undeclared key.
    const order = (amount: Record<string, unknown>): unknown => ({
      domain: DOMAIN,
      message: { amount },
      primaryType: "Order",
      types: { Order: [{ name: "amount", type: "u256" }], StarknetDomain: DOMAIN_TYPE },
    });

    const [honest, padded] = bothRenderings(
      order({ high: "0x0", low: "0x64" }),
      order({ high: "0x0", low: "0x64", note: "1,000,000 USDC" }),
    );

    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).toBe(
      signBlockBody(honest, SIGNED_MESSAGE_LABEL) as string,
    );
    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).toContain("amount.low");
    expect(signBlockBody(padded, UNSIGNED_LABEL)).toContain("amount.note");
    expect(signBlockBody(padded, UNSIGNED_LABEL)).toContain("1,000,000 USDC");
  });

  test("merkle leaves are decoded against the contained type", () => {
    const payload = {
      domain: DOMAIN,
      message: { tree: [{ leaf: "0x1", note: "unsigned" }, { leaf: "0x2" }] },
      primaryType: "Order",
      types: {
        Inner: [{ name: "leaf", type: "felt" }],
        Order: [{ name: "tree", contains: "Inner", type: "merkletree" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    };
    const honest = {
      ...payload,
      message: { tree: [{ leaf: "0x1" }, { leaf: "0x2" }] },
    };
    const [, padded] = bothRenderings(honest, payload);

    // A merkle root commits to the leaf set, not to the leaf order, so leaves
    // are addressed without an ordinal — see sign-request-merkle-order.test.ts.
    expect(signBlockBody(padded, SIGNED_MESSAGE_LABEL)).toContain("tree{}.leaf");
    expect(signBlockBody(padded, UNSIGNED_LABEL)).toContain("tree{}.note");
  });

  test("the not-signed block is visually distinct from the signed one", () => {
    // The label alone is not enough: the block carries its own modifier class
    // so it cannot be mistaken for signed content at a glance.
    const html = signHtml({
      domain: DOMAIN,
      message: { details: { amount: "1", chainId: "SN_SEPOLIA" } },
      primaryType: "Order",
      types: {
        Details: [{ name: "amount", type: "u128" }],
        Order: [{ name: "details", type: "Details" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });

    expect(html).toContain(`<p class="eyebrow">${UNSIGNED_LABEL}</p><div class="sign-block sign-`);
    // The signed message block keeps the plain class.
    expect(html).toContain(
      `<p class="eyebrow">${SIGNED_MESSAGE_LABEL}</p><div class="sign-block">`,
    );
  });

  test("a value the declared type says is a leaf is never split, nor shown as signed", () => {
    // A struct-shaped value under a `felt` field is not a hashable payload at
    // all: `encodeValue` coerces a felt to a field element and an object is not
    // one. The renderer shows it whole rather than inventing signed rows, but
    // whole in the not-signed block — nothing about it is covered.
    const view = signRequestView({
      domain: DOMAIN,
      message: { content: { a: 1 } },
      primaryType: "Message",
      types: {
        Message: [{ name: "content", type: "felt" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });

    expect(signBlockBody(view.html, UNSIGNED_LABEL)).toContain("{&quot;a&quot;:1}");
    // The signed block holds the primary type — the type hash does cover it —
    // and nothing else: no row at all is invented for the unhashable value.
    expect(signBlockBody(view.html, SIGNED_MESSAGE_LABEL)).not.toContain("content");
    expect(signBlockBody(view.html, SIGNED_MESSAGE_LABEL)).not.toContain("{&quot;a&quot;:1}");
    expect(view.classified).toBe(false);
  });
});
