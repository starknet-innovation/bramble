/**
 * MCW-V09-104, round 2: the sign card's signed/not-signed split must be
 * *total*. Every value a payload carries has to land in the signed block AND
 * affect the message hash, or land in the not-signed block; nothing may be
 * dropped from both, and nothing unhashed may appear as signed content.
 *
 * Round 1 split values by declared type but left three ways through:
 *
 *  - a variant declared `()` hashes only its index, so the whole payload the
 *    site attached to it is decoration — and it was pushed into the signed
 *    block whole;
 *  - a variant given more array elements than its tuple declares drops the
 *    extras from *both* blocks;
 *  - the walk's own depth cap dumped the entire remaining subtree, undeclared
 *    keys and all, into the signed block — and the cap sat below the depth the
 *    hashing boundary's JSON budget admits, so a deep-enough payload defeated
 *    the split outright.
 *
 * Each collision test first asserts the two payloads hash byte-identically
 * through the pinned library, so it fails loudly rather than quietly stopping to
 * prove anything if that library changes. Two of them are now also refused
 * outright by `isTypedDataShape` — round 3 closed the mismatched tuple payload at
 * the gate — and the renderer assertions still apply, because the card renders
 * payloads the gate refuses. The last group pins the structural half: a payload
 * the decoder cannot place is reported unclassified and the card withholds the
 * approve control entirely.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { isTypedDataShape, typedDataHash } from "@bramble/starknet/typed-data";
import { typedData as snip12 } from "starknet";
import type { PendingApproval, WalletStatus } from "../../../../src/popup/responses/responses";
import { approvalCard } from "../../../../src/sidepanel/journeys/approvals/approval-cards";
import {
  OUTSIDE_EXECUTION_WARNING,
  SIGN_REQUEST_UNCLASSIFIED_WARNING,
  signRequestView,
} from "../../../../src/sidepanel/shared/sign-request";
import { PRIMARY_TYPE_KEY } from "../../../../src/sidepanel/shared/sign-request-rows";
import {
  SIGNED_MESSAGE_LABEL as SIGNED_LABEL,
  signBlockBody,
  signHtml,
  UNSIGNED_MESSAGE_LABEL,
} from "../../../support/sign-request-blocks";

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const DOMAIN = { chainId: "SN_SEPOLIA", name: "SwapDapp", revision: "1" };
const DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];

const rawHash = (payload: unknown): string =>
  snip12.getMessageHash(payload as Parameters<typeof snip12.getMessageHash>[0], ACCOUNT);

// Asserts the two payloads are indistinguishable to the account that would sign
// them — the pinned library hashes both to one value, and the honest one is a
// payload this wallet really does hash — then hands back both renderings.
const collidingRenderings = (honest: unknown, padded: unknown): readonly [string, string] => {
  expect(rawHash(padded)).toBe(rawHash(honest));
  expect(typedDataHash(honest, ACCOUNT)).toBe(rawHash(honest));
  return [signHtml(honest), signHtml(padded)];
};

// One enum field over a variant list, which is the only place a tuple payload
// can appear in a SNIP-12 graph.
const enumPayload = (variants: readonly Json[], action: Record<string, Json>): Json => ({
  domain: DOMAIN,
  message: { action },
  primaryType: "Msg",
  types: {
    Action: variants,
    Msg: [{ contains: "Action", name: "action", type: "enum" }],
    StarknetDomain: DOMAIN_TYPE,
  },
});

// `levels` single-field structs, Msg -> L0 -> … -> L(levels-1), whose innermost
// value is `leaf`. Used to walk the depth the hashing boundary admits.
const nested = (levels: number, leaf: Record<string, Json>): Json => {
  const types: Record<string, Json> = {
    Msg: [{ name: "l", type: "L0" }],
    StarknetDomain: DOMAIN_TYPE,
  };
  for (let index = 0; index < levels - 1; index += 1) {
    types[`L${index}`] = [{ name: "l", type: `L${index + 1}` }];
  }
  types[`L${levels - 1}`] = [{ name: "amount", type: "felt" }];
  let value: Record<string, Json> = leaf;
  for (let index = levels - 2; index >= 0; index -= 1) {
    value = { l: value };
  }
  return { domain: DOMAIN, message: { l: value }, primaryType: "Msg", types };
};

describe("sign card variant payloads", () => {
  test("the payload of a `()` variant is decoration, not signed content", () => {
    // `encodeValue` reads a variant payload as `type.slice(1,-1).split(",")`
    // and hashes exactly that many elements. `()` names none, so everything the
    // site attaches to the variant is unhashed — and the site chooses the text.
    const variants = [
      { name: "Approve", type: "()" },
      { name: "Reject", type: "()" },
    ];
    const paddedPayload = enumPayload(variants, {
      Approve: ["Approve 1 STRK for swap on SN_SEPOLIA"],
    });
    const [honest, padded] = collidingRenderings(
      enumPayload(variants, { Approve: [] }),
      paddedPayload,
    );
    // The gate now refuses the padded spelling outright; the renderer still has
    // to split it, because it renders payloads the gate refuses.
    expect(isTypedDataShape(paddedPayload)).toBe(false);

    // Which variant was selected *is* hashed, as its index in the list, so the
    // signed block names it — and names it identically for both payloads.
    expect(signBlockBody(padded, SIGNED_LABEL)).toBe(signBlockBody(honest, SIGNED_LABEL) as string);
    expect(signBlockBody(padded, SIGNED_LABEL)).toContain("action.Approve");
    expect(signBlockBody(padded, SIGNED_LABEL)).not.toContain("Approve 1 STRK");

    // The attacker's sentence is carried, whole, on the not-signed side.
    expect(signBlockBody(padded, UNSIGNED_MESSAGE_LABEL)).toContain("action.Approve[0]");
    expect(signBlockBody(padded, UNSIGNED_MESSAGE_LABEL)).toContain(
      "Approve 1 STRK for swap on SN_SEPOLIA",
    );
    // The honest payload attaches nothing, so it has no not-signed block.
    expect(honest).not.toContain(UNSIGNED_MESSAGE_LABEL);
  });

  test("array elements past the declared tuple are carried, not dropped", () => {
    // `(felt)` names one element; `variantData[1]` and beyond are never read,
    // and round 1 showed neither block for them.
    const variants = [{ name: "Pay", type: "(felt)" }];
    const paddedPayload = enumPayload(variants, { Pay: ["1", "SN_MAIN", "0xdead"] });
    const [honest, padded] = collidingRenderings(
      enumPayload(variants, { Pay: ["1"] }),
      paddedPayload,
    );
    expect(isTypedDataShape(paddedPayload)).toBe(false);

    expect(signBlockBody(padded, SIGNED_LABEL)).toBe(signBlockBody(honest, SIGNED_LABEL) as string);
    expect(signBlockBody(padded, SIGNED_LABEL)).toContain("action.Pay[0]");
    expect(signBlockBody(padded, SIGNED_LABEL)).not.toContain("SN_MAIN");
    expect(signBlockBody(padded, SIGNED_LABEL)).not.toContain("0xdead");

    const unsigned = signBlockBody(padded, UNSIGNED_MESSAGE_LABEL);
    expect(unsigned).toContain("action.Pay[1]");
    expect(unsigned).toContain("SN_MAIN");
    expect(unsigned).toContain("action.Pay[2]");
    expect(unsigned).toContain("0xdead");
    expect(honest).not.toContain(UNSIGNED_MESSAGE_LABEL);
  });

  test("a falsy tuple element is unhashed, so it is never shown as signed", () => {
    // `encodeValue` skips a falsy subtype — `if (!subtype) return subtype` — and
    // hashes a constant in its place, so `(felt,)` covers only element 0. The
    // two payloads below differ only in element 1 and hash identically.
    const variants = [{ name: "Pay", type: "(felt,)" }];
    const paddedPayload = enumPayload(variants, { Pay: ["1", "SN_MAIN"] });
    const honestPayload = enumPayload(variants, { Pay: ["1", "honest"] });
    expect(rawHash(paddedPayload)).toBe(rawHash(honestPayload));
    // Neither spelling is signable — `isTupleReference` refuses an empty tuple
    // element — but the card renders refused payloads, so the split still holds.
    expect(isTypedDataShape(honestPayload)).toBe(false);
    const padded = signHtml(paddedPayload);

    expect(signBlockBody(padded, SIGNED_LABEL)).toBe(
      signBlockBody(signHtml(honestPayload), SIGNED_LABEL) as string,
    );
    expect(signBlockBody(padded, SIGNED_LABEL)).toContain("action.Pay[0]");
    expect(signBlockBody(padded, SIGNED_LABEL)).not.toContain("SN_MAIN");
    expect(signBlockBody(padded, UNSIGNED_MESSAGE_LABEL)).toContain("action.Pay[1]");
    expect(signBlockBody(padded, UNSIGNED_MESSAGE_LABEL)).toContain("SN_MAIN");
  });

  test("a variant the list never declares is not presented as signed", () => {
    // `encodeValue` looks the variant up in the list and throws when it is
    // absent, so nothing under it is covered by any signature.
    const view = signRequestView(
      enumPayload([{ name: "Approve", type: "()" }], { Withdraw: ["everything"] }),
    );

    // The signed block carries the primary type and nothing else.
    expect(signBlockBody(view.html, SIGNED_LABEL)).toContain(PRIMARY_TYPE_KEY);
    expect(signBlockBody(view.html, SIGNED_LABEL)).not.toContain("Withdraw");
    expect(signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL)).toContain("action.Withdraw");
    expect(view.classified).toBe(false);
  });

  test("an enum on revision 0 is refused, because that revision has no enums", () => {
    // Revision 0's `encodeValue` has no enum case at all: it falls through to
    // `getHex(data)`, which has no tuple semantics, so the decoder must not
    // pretend it can say what a variant covers there.
    const view = signRequestView({
      domain: { name: "SwapDapp" },
      message: { action: { Approve: [] } },
      primaryType: "Msg",
      types: {
        Action: [{ name: "Approve", type: "()" }],
        Msg: [{ contains: "Action", name: "action", type: "enum" }],
        StarkNetDomain: [{ name: "name", type: "felt" }],
      },
    });

    expect(view.classified).toBe(false);
    expect(signBlockBody(view.html, SIGNED_LABEL)).not.toContain("Approve");
    expect(signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL)).toContain("action");
  });
});

describe("sign card depth handling", () => {
  test("undeclared keys 15 structs deep are still split out", () => {
    const [honest, padded] = collidingRenderings(
      nested(15, { amount: "1" }),
      nested(15, {
        amount: "1",
        chainId: "SN_MAIN",
        note: "you are paying 1 wei",
        recipient: "0xdeadbeef",
      }),
    );

    expect(signBlockBody(padded, SIGNED_LABEL)).toBe(signBlockBody(honest, SIGNED_LABEL) as string);
    expect(signBlockBody(padded, SIGNED_LABEL)).not.toContain("SN_MAIN");
    expect(signBlockBody(padded, SIGNED_LABEL)).not.toContain("you are paying 1 wei");

    const unsigned = signBlockBody(padded, UNSIGNED_MESSAGE_LABEL);
    expect(unsigned).toContain("SN_MAIN");
    expect(unsigned).toContain("0xdeadbeef");
    expect(unsigned).toContain("you are paying 1 wei");
    expect(honest).not.toContain(UNSIGNED_MESSAGE_LABEL);
  });

  test("every nesting depth the hashing boundary accepts is fully classified", () => {
    // The renderer's cap is derived from `JSON_BUDGETS.typedData.maxDepth`, so
    // it cannot drift below the depth the hashing boundary admits. This walks
    // past that boundary in both directions rather than asserting a literal.
    const accepted: number[] = [];
    for (let levels = 1; levels <= 30; levels += 1) {
      const payload = nested(levels, { amount: "1" });
      if (!isTypedDataShape(payload)) {
        continue;
      }
      accepted.push(levels);
      expect(typedDataHash(payload, ACCOUNT)).toMatch(/^0x[0-9a-f]+$/);
      expect(signRequestView(payload).classified).toBe(true);
    }
    // Guards against the loop passing vacuously: the boundary really does admit
    // payloads far deeper than the twelve levels round 1 could classify.
    expect(accepted.length).toBeGreaterThan(20);
    expect(Math.max(...accepted)).toBeGreaterThan(12);
  });

  test("a payload deeper than the walk can classify is refused, not shown as signed", () => {
    const leaf = { amount: "1", note: "not signed at all" };
    const payload = nested(30, leaf);
    // Beyond the JSON budget, so the wallet would never hash it either.
    expect(isTypedDataShape(payload)).toBe(false);

    const view = signRequestView(payload);
    expect(view.classified).toBe(false);
    expect(view.html).toContain(UNSIGNED_MESSAGE_LABEL);
    expect(signBlockBody(view.html, SIGNED_LABEL) ?? "").not.toContain("not signed at all");
  });
});

describe("sign card structural refusal", () => {
  const status: WalletStatus = {
    accountCount: 0,
    accounts: [],
    activeAccountId: null,
    hasVault: true,
    locked: false,
    network: "Starknet Sepolia",
    networkId: "SN_SEPOLIA",
    networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
    ready: true,
  };
  const card = (typedData: Json): string =>
    approvalCard(
      {
        id: "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14",
        kind: "sign-typed-data",
        origin: "https://dapp.example",
        typedData,
      } satisfies PendingApproval,
      status,
    );

  test("a classifiable payload still offers Sign", () => {
    const html = card(enumPayload([{ name: "Approve", type: "()" }], { Approve: [] }));

    expect(html).toContain('data-approval-action="approve"');
    expect(html).not.toContain(SIGN_REQUEST_UNCLASSIFIED_WARNING);
  });

  test("an OutsideExecution capability gets a prominent warning", () => {
    const payload = enumPayload([{ name: "Approve", type: "()" }], { Approve: [] });
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("typed-data fixture must be an object");
    }
    const html = card({ ...payload, primaryType: "OutsideExecution" });

    expect(html).toContain(OUTSIDE_EXECUTION_WARNING);
  });

  test("an unclassifiable payload gets no approve control at all", () => {
    // A struct type holding a scalar: the encoder cannot hash it as the
    // declared shape, so the card cannot say what approving would commit to.
    const html = card({
      domain: DOMAIN,
      message: { details: "1000 USDC to 0xsafe" },
      primaryType: "Msg",
      types: {
        Details: [{ name: "amount", type: "u128" }],
        Msg: [{ name: "details", type: "Details" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });

    // Not merely disabled — absent, so no state can re-enable it.
    expect(html).not.toContain('data-approval-action="approve"');
    expect(html).toContain('data-approval-action="deny"');
    expect(html).toContain(SIGN_REQUEST_UNCLASSIFIED_WARNING);
    // The value is still shown, on the side that cannot mislead.
    expect(html).toContain("1000 USDC to 0xsafe");
    expect(html).toContain(UNSIGNED_MESSAGE_LABEL);
  });

  test("a value under an array type that is not an array is refused too", () => {
    const view = signRequestView({
      domain: DOMAIN,
      message: { items: { note: "one item, honest" } },
      primaryType: "Msg",
      types: {
        Inner: [{ name: "leaf", type: "felt" }],
        Msg: [{ name: "items", type: "Inner*" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    });

    expect(view.classified).toBe(false);
    expect(signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL)).toContain("one item, honest");
    expect(signBlockBody(view.html, SIGNED_LABEL)).not.toContain("one item, honest");
  });

  test("a declared field is read as an own property, never off the prototype", () => {
    // `encodeData` reads `data[field.name]`, which walks the prototype chain: a
    // field named `constructor` resolves to `Object.prototype.constructor` out
    // of an empty message. The gate refuses such a payload — pinned in
    // tests/starknet/typed-data-value-conformance.test.ts — but this card
    // renders payloads the gate refuses, and it must not print a function the
    // site never sent as a value the account is about to sign.
    const payload: Json = {
      domain: DOMAIN,
      message: {},
      primaryType: "Msg",
      types: {
        Foo: [{ name: "name", type: "shortstring" }],
        Msg: [{ name: "constructor", type: "Foo" }],
        StarknetDomain: DOMAIN_TYPE,
      },
    };
    expect(isTypedDataShape(payload)).toBe(false);

    const html = signRequestView(payload).html;
    expect(html).not.toContain("native code");
    expect(html).not.toContain("function Object");
    // The field is still named — on the not-signed side, because a declared
    // struct field the site never sent is not something the card can describe.
    expect(signBlockBody(html, UNSIGNED_MESSAGE_LABEL)).toContain("constructor");
    expect(signRequestView(payload).classified).toBe(false);
  });
});
