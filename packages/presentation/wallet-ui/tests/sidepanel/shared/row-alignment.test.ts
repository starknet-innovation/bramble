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
    // A receipt value keeps a 10ch basis: beside a label too long to leave it
    // that much (the 320px panel) it drops to its own line instead of shrinking
    // to a sliver whose text spills over the label.
    [".receipt-row", ".receipt-row dd", "flex: 1 1 10ch"],
    [
      ".send-context-receipt > div, .send-review-facts > div",
      ".send-context-receipt dd, .send-review-facts dd",
      "flex: 1 1 0",
    ],
  ])("%s aligns its label to the value's first line and stays centred", (row, value, basis) => {
    const declarations = rule(row);
    expect(declarations).toContain("align-items: baseline");
    // The single line box is centred in the row's minimum height…
    expect(declarations).toContain("flex-wrap: wrap");
    expect(declarations).toContain("align-content: center");
    // …and the value's basis keeps label and value on that one line while
    // the value still has room beside its label.
    expect(rule(value)).toContain(basis);
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

  // Label/value rows that overlapped at the 320px minimum panel: a column
  // with a zero basis and no floor gave its neighbour the whole line and its
  // own text spilled over it. The UI Lab minimum-width stories measure the
  // result; these pin the rules.
  test("a navigation row's label keeps its longest word beside the value", () => {
    expect(rule(":is(button, a).menu-row > .menu-copy")).toContain("flex: 1 1 auto");
    expect(rule(":is(button, a).menu-row > .menu-copy")).toContain("min-width: auto");
    expect(rule(".menu-value")).toContain("overflow-wrap: break-word");
  });

  test("a flow title never narrows below its longest word; the pill wraps instead", () => {
    expect(rule(".flow-header")).toContain("flex-wrap: wrap");
    expect(rule(".flow-title")).toContain("min-width: min-content");
    expect(rule(".flow-title")).toContain("grid-template-columns: minmax(min-content, 1fr)");
  });

  test("the home tab bar cannot widen the token list past the panel", () => {
    expect(rule(".home-tabs")).toContain("grid-template-columns: minmax(0, 1fr)");
  });

  test("the multisig exact-identity receipt no longer overrides the shared alignment", () => {
    expect(CSS).not.toMatch(/\[data-ms-exact-identity\] \.receipt-row \{[^}]*align-items/);
  });
});
