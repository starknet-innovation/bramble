/**
 * Source guard for #69 (Decision A): no terminal code may build, sign or send an
 * Extended order. Enabling placement must be a reviewed change that edits this
 * test together with ./perps-placement.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PERPS_ORDER_PLACEMENT } from "./perps-placement";

const ROOT = join(__dirname, "../../..");
const SCANNED = ["src", "api", "shared"];
const SOURCE = /\.(ts|tsx)$/;
const TEST = /\.test\.(ts|tsx)$/;

// Markers of an Extended private (account) API call or an order signer.
const ORDER_MARKERS: readonly RegExp[] = [
  /\/user\/order/i,
  /\/api\/v1\/user\//i,
  /x-api-key/i,
  /signOrder/,
  /\bplaceOrder\b/,
];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return SOURCE.test(name) && !TEST.test(name) ? [path] : [];
  });

describe("Extended order placement stays gated (#69)", () => {
  it("records the gated decision", () => {
    expect(PERPS_ORDER_PLACEMENT.status).toBe("gated");
  });

  it("has no source that calls Extended's account API or signs an order", () => {
    const hits = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir))).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return ORDER_MARKERS.filter((marker) => marker.test(text)).map(
        (marker) => `${relative(ROOT, file)} matches ${marker}`,
      );
    });
    expect(hits).toEqual([]);
  });
});
