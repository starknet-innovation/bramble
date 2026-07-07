/**
 * QR encoder checks: structure, determinism, and capacity limits. Decode
 * correctness is verified against the jsQR decoder in development; these
 * tests pin the structural invariants that verification relied on.
 */
import { describe, expect, test } from "bun:test";
import { qrMatrix, qrSvg } from "../src/sidepanel/qr";

const ADDRESS = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";

describe("qrMatrix", () => {
  test("selects the version by payload size", () => {
    expect(qrMatrix("HI")).toHaveLength(21);
    expect(qrMatrix(ADDRESS)).toHaveLength(37);
    expect(qrMatrix("a".repeat(100))).toHaveLength(41);
  });

  test("draws finder and timing patterns", () => {
    const matrix = qrMatrix(ADDRESS);
    expect(matrix[0]?.[0]).toBe(true);
    expect(matrix[1]?.[1]).toBe(false);
    expect(matrix[3]?.[3]).toBe(true);
    expect(matrix[6]?.[8]).toBe(true);
    expect(matrix[6]?.[9]).toBe(false);
    expect(matrix[matrix.length - 8]?.[8]).toBe(true);
  });

  test("is deterministic and rejects oversized payloads", () => {
    expect(qrMatrix(ADDRESS)).toEqual(qrMatrix(ADDRESS));
    expect(() => qrMatrix("a".repeat(200))).toThrow("QR payload too long");
  });
});

describe("qrSvg", () => {
  test("renders an accessible inline SVG", () => {
    const svg = qrSvg(ADDRESS);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('class="qr"');
    expect(svg).toContain("<rect");
  });
});
