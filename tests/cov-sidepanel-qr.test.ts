/**
 * QR encoder boundary cases: an empty payload still yields the smallest valid
 * matrix, and an over-long payload (past version 6 capacity) is rejected rather
 * than silently truncated.
 */
import { describe, expect, test } from "bun:test";
import { qrMatrix, qrSvg } from "../src/sidepanel/qr";

describe("qrMatrix boundaries", () => {
  test("encodes an empty payload as the smallest (version 1) matrix", () => {
    const matrix = qrMatrix("");
    expect(matrix).toHaveLength(21);
    // The top-left finder pattern is always present regardless of payload.
    expect(matrix[0]?.[0]).toBe(true);
    expect(matrix[1]?.[1]).toBe(false);
  });

  test("rejects a payload that exceeds the largest supported version", () => {
    // Version 6 tops out well under 200 bytes, so no spec is found and the
    // encoder throws instead of producing a corrupt matrix.
    expect(() => qrMatrix("z".repeat(200))).toThrow("QR payload too long");
  });

  test("qrSvg renders an accessible SVG for an empty payload", () => {
    const svg = qrSvg("");
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<rect");
  });
});
