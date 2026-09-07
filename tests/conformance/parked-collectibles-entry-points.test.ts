/**
 * Guards the parked collectibles journey: the wallet UI must render no entry
 * point into it.
 *
 * The gallery screens, their bindings, and their renderers deliberately stay in
 * the tree under `journeys/collectibles/` so restoring the feature is one
 * revert. What makes them unreachable today is only the absence of markup that
 * navigates to them, and that absence is invisible: a single
 * `button({ attributes: { "data-view": "nfts" } })` added anywhere in a future
 * menu, token row, or settings screen silently reopens the whole journey, with
 * every existing test still green.
 *
 * So this scans the production wallet-ui sources rather than one screen's HTML.
 * It covers the markup vector only — a `data-view` naming an `nft*` view, or a
 * `data-nft-open` tile hook — because navigation into those views is reachable
 * from nothing else while no such markup exists.
 *
 * Delete this file when the journey is un-parked.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isParkedCollectibleView, PARKED_COLLECTIBLE_VIEWS } from "@bramble/wallet-ui/lab";

const WALLET_UI_SRC = join(import.meta.dir, "../../packages/presentation/wallet-ui/src");

// The journey's own modules are exempt: they are the parked code, and they are
// the files a future un-park edits back into reach.
const PARKED_JOURNEY_DIR = join("sidepanel", "journeys", "collectibles");

const sourceFiles = (root: string): readonly string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true }).flatMap((entry) =>
    entry.isFile() && entry.name.endsWith(".ts")
      ? [relative(WALLET_UI_SRC, join(entry.parentPath, entry.name))]
      : [],
  );

const entryPointHits = (source: string, view: (typeof PARKED_COLLECTIBLE_VIEWS)[number]): boolean =>
  new RegExp(
    `(?:data-view\\s*=\\s*["']${view}["']|["']data-view["']\\s*:\\s*["']${view}["']|walletMenuRow\\(\\s*["']${view}["']|navigate\\(\\s*["']${view}["'])`,
  ).test(source);

describe("parked collectibles entry points", () => {
  test("the view list still names the parked gallery screens", () => {
    // If this changes, the patterns below are checking for the wrong views.
    expect([...PARKED_COLLECTIBLE_VIEWS]).toEqual([
      "nfts",
      "nft-watch",
      "nft-hidden",
      "nft-detail",
      "nft-send",
    ]);
    expect(PARKED_COLLECTIBLE_VIEWS.every(isParkedCollectibleView)).toBe(true);
    expect(isParkedCollectibleView("home")).toBe(false);
  });

  test("no production wallet-ui module renders a route into the gallery", () => {
    const files = sourceFiles(WALLET_UI_SRC);
    // A scan that walked nothing would pass vacuously.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.flatMap((file) => {
      if (file.startsWith(`${PARKED_JOURNEY_DIR}${sep}`)) {
        return [];
      }
      const source = readFileSync(join(WALLET_UI_SRC, file), "utf8");
      const hits = [
        ...PARKED_COLLECTIBLE_VIEWS.flatMap((view) => (entryPointHits(source, view) ? [view] : [])),
        ...(source.includes("data-nft-open") ? ["data-nft-open"] : []),
      ];
      return hits.length > 0 ? [`${file}: ${hits.join(", ")}`] : [];
    });

    expect(offenders).toEqual([]);
  });
});
