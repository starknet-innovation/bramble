/**
 * Receipt injectivity over scalar values: two payloads the account would sign
 * differently must never produce the same default sign-card receipt, and two
 * spellings of one signed value must produce the same one.
 *
 * `tests/starknet/typed-data-injectivity.test.ts` sweeps the other dimension —
 * type *graphs* — and generates only canonical hexadecimal leaf values, so it
 * could not see this one: the defect lived entirely in how a leaf value is read
 * and printed. Here the graph is held fixed at a single-field message and the
 * value dimension is swept instead, across both revisions and every basic type,
 * with the spellings a hostile site actually has available — prose, hexadecimal
 * and decimal spellings of one number, leading zeros, whitespace- and
 * sign-padded numbers, boolean against the string that spells it, boundary
 * integers, short strings, and entry point names against their felts.
 *
 * Two directions are asserted, because only both together mean anything:
 *
 *  - no two accepted payloads with different message hashes share a receipt.
 *    This is the security property. It is what fails when a `u128` renders a
 *    sentence, or a `felt` renders `false` for a string that encodes nonzero;
 *  - accepted spellings of one signed value under one type render identically,
 *    so normalizing the receipt has not turned into a second way to disguise a
 *    value.
 *
 * The sweep is kept honest the same way the graph sweep is: it asserts the
 * corpus actually reached hashes, that it accepted every display form, and that
 * the same collision search *does* flag the receipts the card produced before —
 * the value alone, with no declared type and no encoded felt beside it.
 */
import { describe, expect, test } from "bun:test";
import { type Snip12Scalar, snip12Scalar } from "@bramble/starknet/snip12-scalars";
import { isTypedDataShape, typedDataHash } from "@bramble/starknet/typed-data";
import { signRequestView } from "../../../../src/sidepanel/shared/sign-request";
import {
  SIGNED_DOMAIN_LABEL,
  SIGNED_MESSAGE_LABEL,
  signBlocks,
} from "../../../support/sign-request-blocks";

type Revision = "0" | "1";
// One accepted payload: what it says, what it signs, and how the card shows it.
type Entry = {
  readonly hash: string;
  readonly receipt: string;
  readonly revision: Revision;
  readonly scalar: Snip12Scalar;
  readonly type: string;
  readonly value: unknown;
};

const ACCOUNT = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

const REV1_DOMAIN = [
  { name: "name", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];
const REV0_DOMAIN = [{ name: "name", type: "felt" }];

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

const TYPES = [
  "ClassHash",
  "ContractAddress",
  "bool",
  "felt",
  "i128",
  "selector",
  "shortstring",
  "string",
  "timestamp",
  "u128",
] as const;

const U128_MAX = (1n << 128n) - 1n;
const I128_MIN = -(1n << 127n);
const FELT_MAX = BigInt("0x800000000000011000000000000000000000000000000000000000000000000");

// Every spelling a site can put under a declared type. Grouped by the trick each
// one is: aliases of one number, text that encodes to a number, the two ways to
// write a boolean, values that sit on a type's boundary, and text that is only
// text. `1000` appears as five spellings and `0x66616c7365` as two, so the
// normalization direction has something to be about.
const VALUES: readonly unknown[] = [
  "1000",
  1000,
  "0x3e8",
  "0x03e8",
  "0X3E8",
  "007",
  7,
  "0",
  0,
  "0x0",
  "-0",
  " 12 ",
  "+12",
  "0b101",
  "0o17",
  "",
  "1_000",
  "0x",
  false,
  true,
  "false",
  "true",
  "no fee required",
  "0x6e6f20666565207265717569726564",
  "unlimited",
  "SN_MAIN",
  "a b",
  "transfer",
  "0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e",
  "-5",
  -5,
  I128_MIN.toString(),
  (I128_MIN - 1n).toString(),
  U128_MAX.toString(),
  (U128_MAX + 1n).toString(),
  FELT_MAX.toString(),
  (FELT_MAX + 1n).toString(),
  1.5,
  "12.0",
  "a".repeat(31),
  "a".repeat(32),
  "hello world",
];

// The card's default view: every block it presents as signed — the domain,
// which carries the revision the payload is hashed under, and the message.
// Nothing here consults the raw block, which is collapsed by default and is
// explicitly not the mitigation.
const receiptOf = (payload: unknown): string => {
  const view = signRequestView(payload);
  expect(view.classified).toBe(true);
  return signBlocks(view.html)
    .filter(([label]) => label === SIGNED_DOMAIN_LABEL || label === SIGNED_MESSAGE_LABEL)
    .map(([label, body]) => `${label}${body}`)
    .join("");
};

const built: Entry[] = [];
let refused = 0;
for (const revision of ["0", "1"] as const) {
  for (const type of TYPES) {
    for (const value of VALUES) {
      const payload = envelope(revision, type, value);
      const resolved = snip12Scalar(value, type, revision);
      if (!isTypedDataShape(payload)) {
        refused += 1;
        // The gate and the leaf reader are the same rule; a payload refused by
        // one and admitted by the other would mean the card is describing a
        // value the wallet will not sign, or the reverse.
        expect(resolved).toBeNull();
        continue;
      }
      expect(resolved).not.toBeNull();
      built.push({
        hash: typedDataHash(payload, ACCOUNT),
        receipt: receiptOf(payload),
        revision,
        scalar: resolved as Snip12Scalar,
        type,
        value,
      });
    }
  }
}

// Returns the first pair of entries that share a key while differing in
// `distinct`, formatted for the failure message.
const collision = (
  entries: readonly Entry[],
  keyOf: (entry: Entry) => string,
  distinct: (entry: Entry) => string,
): string | null => {
  const seen = new Map<string, Entry>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const prior = seen.get(key);
    if (prior === undefined) {
      seen.set(key, entry);
    } else if (distinct(prior) !== distinct(entry)) {
      return `${key}\n  ${prior.revision} ${prior.type} ${JSON.stringify(prior.value)}\n  ${entry.revision} ${entry.type} ${JSON.stringify(entry.value)}`;
    }
  }
  return null;
};

const identity = (entry: Entry): string =>
  JSON.stringify([entry.revision, entry.type, entry.scalar.kind, entry.scalar.encoded]);

describe("sign card receipts are injective over scalar values", () => {
  test("the corpus reached hashes, was refused where it should be, and covers every display form", () => {
    expect(built.length).toBeGreaterThan(150);
    expect(refused).toBeGreaterThan(300);
    expect(new Set(built.map((entry) => entry.hash)).size).toBeGreaterThan(100);
    for (const revision of ["0", "1"] as const) {
      expect(built.filter((entry) => entry.revision === revision).length).toBeGreaterThan(70);
    }
    // A display form with no entry is a form this sweep says nothing about.
    for (const kind of ["boolean", "bytestring", "felt", "integer", "selector", "text"]) {
      expect(built.some((entry) => entry.scalar.kind === kind)).toBe(true);
    }
  });

  test("every receipt states the felt the account would authorize", () => {
    for (const entry of built) {
      expect(entry.receipt).toContain(entry.scalar.encoded);
      expect(entry.receipt).toContain(entry.type);
    }
  });

  test("no two payloads with different message hashes share a receipt", () => {
    expect(
      collision(
        built,
        (entry) => entry.receipt,
        (entry) => entry.hash,
      ),
    ).toBeNull();
  });

  test("the same search flags the receipts the card produced before, so a clean run means something", () => {
    // The previous receipt was the value alone, through `String(value)`: no
    // declared type, no encoded felt. Under that rule one accepted spelling
    // covers several distinct signed meanings.
    const before = (entry: Entry): string => String(entry.value);
    expect(collision(built, before, (entry) => entry.hash)).not.toBeNull();
  });

  test("accepted spellings of one signed value render identically", () => {
    expect(collision(built, identity, (entry) => entry.receipt)).toBeNull();
    // …and the normalization is doing work: several spellings really did
    // collapse onto one receipt rather than each being its own group.
    const groups = new Map<string, number>();
    for (const entry of built) {
      groups.set(identity(entry), (groups.get(identity(entry)) ?? 0) + 1);
    }
    expect([...groups.values()].filter((count) => count > 1).length).toBeGreaterThan(10);
  });

  test("text that encodes to a number is shown as text and as that number", () => {
    // A `felt` holds a short string, so the text form stays signable — but the
    // row has to carry the felt it encodes to, because that is what a verifier
    // reads. A numeric type refuses the text form outright.
    const asText = built.find(
      (entry) => entry.type === "felt" && entry.value === "no fee required",
    );
    expect(asText?.scalar.kind).toBe("text");
    expect(asText?.receipt).toContain("0x6e6f20666565207265717569726564");
    expect(built.some((entry) => entry.type === "u128" && entry.value === "no fee required")).toBe(
      false,
    );
    // The boolean and the string that spells it are never one row: `bool` takes
    // only the boolean, and the string is a nonzero felt wherever it is taken.
    const spelled = built.find((entry) => entry.type === "felt" && entry.value === "false");
    expect(spelled?.scalar.encoded).toBe("0x66616c7365");
    expect(built.some((entry) => entry.type === "felt" && entry.value === false)).toBe(false);
  });
});
