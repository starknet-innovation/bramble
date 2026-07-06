/**
 * Tests for safe popup HTML interpolation.
 */
import { expect, test } from "bun:test";

import { escapeHtml } from "../src/shared/html";

test("escapeHtml escapes template-sensitive characters", () => {
  expect(escapeHtml('<button data-id="x&y">')).toBe("&lt;button data-id=&quot;x&amp;y&quot;&gt;");
});
