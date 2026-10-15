/**
 * Row alignment (#385 workstream 4): in a label/value fact, the label sits on
 * the first line of its value. Centring the pair put "From" halfway down a
 * name-over-address value, and top-aligning a caption label against a body
 * value left their baselines 3 px apart. Measured across the UI Lab journeys
 * before the fix; these pin the rules that fixed it.
 */
import { describe, expect, test } from "bun:test";
import { SIDEPANEL_STYLES } from "../../../src/sidepanel/styles/index";

const CSS = SIDEPANEL_STYLES.replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of the first rule whose selector list is exactly `selector`. */
const rule = (selector: string): string => {
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((match[1] ?? "").trim().replace(/\s+/g, " ") === selector) return match[2] ?? "";
  }
  throw new Error(`No rule for ${selector}`);
};

describe("row alignment", () => {
  test.each([
    [".receipt-row", ".receipt-row dd"],
    [
      ".send-context-receipt > div, .send-review-facts > div",
      ".send-context-receipt dd, .send-review-facts dd",
    ],
  ])("%s aligns its label to the value's first line and stays centred", (row, value) => {
    const declarations = rule(row);
    expect(declarations).toContain("align-items: baseline");
    // The single line box is centred in the row's minimum height…
    expect(declarations).toContain("flex-wrap: wrap");
    expect(declarations).toContain("align-content: center");
    // …and the value's zero basis keeps label and value on that one line.
    expect(rule(value)).toContain("flex: 1 1 0");
  });

  test("a request fact's caption label shares its value's baseline", () => {
    expect(rule(".request-detail > div")).toContain("align-items: baseline");
  });

  test("a value led by a mark centres its label on the mark instead", () => {
    expect(
      rule(
        ".send-context-receipt > div:has(> dd.network-inline-value), .send-review-facts > div:has(.send-review-amount)",
      ),
    ).toContain("align-items: center");
  });

  test("the multisig exact-identity receipt no longer overrides the shared alignment", () => {
    expect(CSS).not.toMatch(/\[data-ms-exact-identity\] \.receipt-row \{[^}]*align-items/);
  });
});
