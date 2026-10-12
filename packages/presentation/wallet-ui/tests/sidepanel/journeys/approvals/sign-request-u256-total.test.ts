/**
 * A preset `u256` amount is stated once as a whole (Sherlock 262).
 *
 * The preset is two `u128` limbs, and the card printed each on its own row, so
 * two amounts one base unit apart could read with opposite magnitudes: 2^128 - 1
 * as a 39-digit number beside a zero, 2^128 as a zero beside a one. The card now
 * adds the total on the struct's own row, above the limbs it is made of.
 */
import { describe, expect, test } from "bun:test";
import {
  SIGNED_MESSAGE_LABEL,
  signBlockBody,
  signHtml,
} from "../../../support/sign-request-blocks";

const DOMAIN = { chainId: "SN_MAIN", name: "Bramble Test", revision: "1", version: "1" };
const DOMAIN_TYPE = [
  { name: "name", type: "shortstring" },
  { name: "version", type: "shortstring" },
  { name: "chainId", type: "shortstring" },
  { name: "revision", type: "shortstring" },
];

const order = (amount: unknown, types: Record<string, unknown> = {}): unknown => ({
  domain: DOMAIN,
  message: { amount },
  primaryType: "Order",
  types: { Order: [{ name: "amount", type: "u256" }], StarknetDomain: DOMAIN_TYPE, ...types },
});

const signed = (payload: unknown): string =>
  signBlockBody(signHtml(payload), SIGNED_MESSAGE_LABEL) ?? "";

const BELOW = ((1n << 128n) - 1n).toString();
const ABOVE = (1n << 128n).toString();

describe("sign card u256 total", () => {
  test("states each side of the 2^128 boundary in order", () => {
    const below = signed(order({ high: "0x0", low: `0x${((1n << 128n) - 1n).toString(16)}` }));
    const above = signed(order({ high: "0x1", low: "0x0" }));
    expect(below).toContain(`${BELOW} (u256 total of high and low)`);
    expect(above).toContain(`${ABOVE} (u256 total of high and low)`);
  });

  test("keeps both limbs, which are what the hash covers", () => {
    const body = signed(order({ high: "0x1", low: "0x5" }));
    expect(body).toContain("amount.low");
    expect(body).toContain("amount.high");
    expect(body).toContain(`${((1n << 128n) + 5n).toString()} (u256 total`);
  });

  test("reads decimal limbs the way the hash does", () => {
    const body = signed(order({ high: "1", low: BELOW }));
    expect(body).toContain(`${((1n << 128n) + (1n << 128n) - 1n).toString()} (u256 total`);
  });

  test("states no total when a limb is not a u128", () => {
    const body = signHtml(order({ high: `0x${(1n << 128n).toString(16)}`, low: "0x0" }));
    expect(body).toContain("amount.low");
    expect(body).not.toContain("u256 total");
  });

  test("states no total for a payload that declares its own u256", () => {
    const own = signed(
      order(
        { high: "0x1", low: "0x0" },
        {
          u256: [
            { name: "low", type: "u128" },
            { name: "high", type: "u128" },
          ],
        },
      ),
    );
    expect(own).toContain("amount.high");
    expect(own).not.toContain("u256 total");
  });
});
