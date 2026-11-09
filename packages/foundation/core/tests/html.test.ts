/**
 * Tests for safe popup HTML interpolation.
 */
import { expect, test } from "bun:test";

import { escapeHtml } from "@bramble/core/html";

test("escapeHtml escapes template-sensitive characters", () => {
  expect(escapeHtml(`<button data-id="x&y" data-name='z'>`)).toBe(
    "&lt;button data-id=&quot;x&amp;y&quot; data-name=&#39;z&#39;&gt;",
  );
});
