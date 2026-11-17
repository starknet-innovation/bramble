/**
 * Empty-state markup accepts only the two ARIA roles the control offers.
 * A third value must not be interpolated into the attribute.
 */
import { describe, expect, test } from "bun:test";
import { emptyState } from "@bramble/ui-kit/content";

describe("emptyState", () => {
  test("renders the two offered roles and escapes the message", () => {
    expect(emptyState("Nothing here", "status")).toBe(
      '<p class="empty" role="status">Nothing here</p>',
    );
    expect(emptyState("Try again", "alert")).toBe('<p class="empty" role="alert">Try again</p>');
    expect(emptyState("<b>")).toBe('<p class="empty">&lt;b&gt;</p>');
  });

  test("drops a role that is not alert or status", () => {
    const html = emptyState("Quiet", `" onload="alert(1)` as "alert");
    expect(html).toBe('<p class="empty">Quiet</p>');
    expect(html).not.toContain("onload");
  });
});
