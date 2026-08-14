/**
 * MCW-V09-104, display half: the sign card's not-signed banner is the whole
 * mitigation, so nothing a site controls may imitate it, scroll it away, or
 * disguise a key printed beneath it.
 *
 * Three findings are pinned here, each reproduced against a payload the hashing
 * boundary accepts and the card offers to sign:
 *
 *  - a `primaryType` of "shown by the site but NOT signed" used to be
 *    interpolated into the message eyebrow, producing two byte-identical
 *    headings — one over the signed rows and one over the site's claims;
 *  - the not-signed block had no cap on rows or on rendered value length, so a
 *    thousand undeclared keys put tens of screens of site text between its
 *    banner and the decision controls;
 *  - `src/starknet/typed-data.ts` refuses to hash a *declared* name carrying a
 *    bidi override or a homoglyph, precisely because it "would read as a
 *    different structure on the approval card than the one that gets hashed" —
 *    but undeclared message keys skip that grammar entirely, and this card is
 *    what started printing them.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@mc-wallet/core/json";
import { isTypedDataShape } from "@mc-wallet/starknet/typed-data";
import {
  SIGN_REQUEST_STYLES,
  signRequestView,
} from "../../../../src/sidepanel/shared/sign-request";
import { SIGN_ROW_LIMIT, signNameText } from "../../../../src/sidepanel/shared/sign-request-text";
import {
  SIGNED_MESSAGE_LABEL,
  signBlockBody,
  signBlocks,
  UNSIGNED_MESSAGE_LABEL,
} from "../../../support/sign-request-blocks";

const DOMAIN = { chainId: "SN_SEPOLIA", name: "app", revision: "1" };
const DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];

const keysOf = (block: string): readonly string[] =>
  [...block.matchAll(/<span class="sign-key">([^<]*)<\/span>/g)].map(([, key]) => key ?? "");

describe("the not-signed banner cannot be imitated", () => {
  test("a primaryType spelling the banner does not produce two identical headings", () => {
    const banner = "shown by the site but NOT signed";
    const payload: Json = {
      domain: DOMAIN,
      message: { amount: "1", chainId: "SN_MAIN", recipient: "0xdeadbeef" },
      primaryType: banner,
      types: { StarknetDomain: DOMAIN_TYPE, [banner]: [{ name: "amount", type: "felt" }] },
    };
    // The payload is one the wallet really would sign, so the heading is
    // reachable rather than hypothetical.
    expect(isTypedDataShape(payload)).toBe(true);
    const view = signRequestView(payload);
    expect(view.classified).toBe(true);

    const labels = signBlocks(view.html).map(([label]) => label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual([
      "Domain",
      SIGNED_MESSAGE_LABEL,
      "Message — shown by the site but NOT signed",
    ]);
    // The primary type is still shown — as a row, in the signed block, because
    // the type hash covers it.
    expect(signBlockBody(view.html, SIGNED_MESSAGE_LABEL)).toContain(banner);
  });

  test("no heading carries any payload-supplied text at all", () => {
    const view = signRequestView({
      domain: DOMAIN,
      message: { amount: "1" },
      primaryType: "Msg",
      types: { Msg: [{ name: "amount", type: "felt" }], StarknetDomain: DOMAIN_TYPE },
    });

    for (const [label] of signBlocks(view.html)) {
      expect(label).not.toContain("Msg");
    }
  });
});

describe("the not-signed block is bounded", () => {
  const many = (): Record<string, Json> => {
    const value: Record<string, Json> = { a: "1" };
    for (let index = 0; index < 100; index += 1) {
      value[`k${index}`] = "Approve 1 STRK on SN_SEPOLIA";
    }
    return value;
  };

  test("a thousand undeclared keys collapse into a capped, counted list", () => {
    const types: Record<string, Json> = { StarknetDomain: DOMAIN_TYPE };
    const fields: Json[] = [];
    const message: Record<string, Json> = {};
    for (let index = 0; index < 10; index += 1) {
      types[`S${index}`] = [{ name: "a", type: "felt" }];
      fields.push({ name: `f${index}`, type: `S${index}` });
      message[`f${index}`] = many();
    }
    types["Msg"] = fields;
    const payload: Json = { domain: DOMAIN, message, primaryType: "Msg", types };
    // Boundary-accepted and classified, so the card really does offer to sign it.
    expect(isTypedDataShape(payload)).toBe(true);
    const view = signRequestView(payload);
    expect(view.classified).toBe(true);

    const unsigned = signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL) as string;
    const rows = (unsigned.match(/class="sign-row/g) ?? []).length;
    expect(rows).toBe(SIGN_ROW_LIMIT + 1);
    expect(unsigned).toContain(`${1000 - SIGN_ROW_LIMIT} more values not shown`);
  });

  test("a single enormous value is truncated rather than rendered whole", () => {
    const note = "N".repeat(43_000);
    const payload: Json = {
      domain: DOMAIN,
      message: { note },
      primaryType: "Msg",
      types: { Msg: [{ name: "note", type: "string" }], StarknetDomain: DOMAIN_TYPE },
    };
    expect(isTypedDataShape(payload)).toBe(true);

    const signed = signBlockBody(signRequestView(payload).html, SIGNED_MESSAGE_LABEL) as string;
    expect(signed).not.toContain(note);
    expect(signed).toContain("characters, see Raw typed data");
    expect(signed.length).toBeLessThan(1_000);
  });

  test("the block itself is height-capped, like the raw block beside it", () => {
    expect(SIGN_REQUEST_STYLES).toContain("max-height: 240px");
  });
});

describe("signed fields are never hidden behind the row cap", () => {
  test("renders every signed message field inside the signed block", () => {
    const fields = Array.from({ length: SIGN_ROW_LIMIT + 10 }, (_, index) => ({
      name: `f${index}`,
      type: "felt",
    }));
    const message = Object.fromEntries(fields.map(({ name }, index) => [name, `0x${index + 1}`]));
    const payload: Json = {
      domain: DOMAIN,
      message,
      primaryType: "Msg",
      types: { Msg: fields, StarknetDomain: DOMAIN_TYPE },
    };
    expect(isTypedDataShape(payload)).toBe(true);

    const signed = signBlockBody(signRequestView(payload).html, SIGNED_MESSAGE_LABEL) as string;
    expect(keysOf(signed)).toContain(`f${SIGN_ROW_LIMIT + 9}`);
    expect(signed).not.toContain("more values not shown");
  });
});

describe("every key the card prints obeys the SNIP-12 name grammar", () => {
  test("bidi, zero-width, homoglyph and overlong undeclared keys are sanitized", () => {
    const payload: Json = {
      domain: DOMAIN,
      message: {
        amount: "1",
        // Right-to-left override, so this renders as "chainId: SN_MAIN".
        "‮NIAM_NS :dIniahc": "spoof",
        // Zero-width space, so this is indistinguishable from `recipient`.
        "recipient​": "0xEVIL",
        // Cyrillic "с", so this is indistinguishable from `chainId`.
        сhainId: "SN_MAIN",
        [`${"A".repeat(200)}`]: "long",
      },
      primaryType: "Pay",
      types: { Pay: [{ name: "amount", type: "felt" }], StarknetDomain: DOMAIN_TYPE },
    };
    // The gate accepts it — its *declared* names are all clean — so these keys
    // reach a card the user is invited to sign from.
    expect(isTypedDataShape(payload)).toBe(true);

    const unsigned = signBlockBody(signRequestView(payload).html, UNSIGNED_MESSAGE_LABEL) as string;
    const keys = keysOf(unsigned);
    // Nothing raw survives: no bidi control, no zero-width, no Cyrillic, and no
    // key longer than a name may be.
    for (const key of keys) {
      expect(key).toMatch(/^«[A-Za-z0-9 _-]*»$/);
      expect(key.length).toBeLessThan(32);
    }
    // And none of them can be mistaken for the real key it was imitating.
    expect(keys).not.toContain("recipient");
    expect(keys).not.toContain("chainId");
    // The values are still there, on the side that cannot mislead.
    expect(unsigned).toContain("0xEVIL");
    expect(unsigned).toContain("SN_MAIN");
  });

  test("the card's name grammar is the hashing gate's own, name for name", () => {
    // The cross-surface pin: `isSafeSnip12Name` is the single grammar, so a name
    // the gate will hash is a name the card prints unchanged, and a name the
    // card sanitizes is a name the gate refuses. A private copy on either side
    // passes its own tests and fails this one.
    const named = (name: string): Json => ({
      domain: DOMAIN,
      message: { [name]: "1" },
      primaryType: "Msg",
      types: { Msg: [{ name, type: "felt" }], StarknetDomain: DOMAIN_TYPE },
    });
    for (const name of [
      "ok",
      "Session Key",
      "a-b",
      "a_b",
      "1",
      "A".repeat(64),
      "to.address",
      "A".repeat(65),
      " leading",
      "trailing ",
      "сhainId",
      "with​zero",
      "",
    ]) {
      expect(isTypedDataShape(named(name))).toBe(signNameText(name) === name);
    }
  });

  test("a declared key that passed the grammar is printed unchanged", () => {
    const view = signRequestView({
      domain: DOMAIN,
      message: { "Session Key": "0x9" },
      primaryType: "Msg",
      types: { Msg: [{ name: "Session Key", type: "felt" }], StarknetDomain: DOMAIN_TYPE },
    });

    expect(keysOf(signBlockBody(view.html, SIGNED_MESSAGE_LABEL) as string)).toContain(
      "Session Key",
    );
  });

  test("a value carrying a bidi override is escaped, not rendered", () => {
    const view = signRequestView({
      domain: DOMAIN,
      message: { amount: "1", note: "‮DEXIF SI 1 GNIDNES" },
      primaryType: "Msg",
      types: { Msg: [{ name: "amount", type: "felt" }], StarknetDomain: DOMAIN_TYPE },
    });

    const unsigned = signBlockBody(view.html, UNSIGNED_MESSAGE_LABEL) as string;
    expect(unsigned).not.toContain("‮");
    expect(unsigned).toContain("\\u202e");
  });
});
