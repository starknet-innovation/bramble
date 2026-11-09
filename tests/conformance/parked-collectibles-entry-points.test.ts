/**
 * Guards the collectibles journey's entry points: the wallet UI renders a way
 * into it only from places gated by the NFTs setting ("Show NFTs on Home",
 * `nftsShown`), so turning NFTs off really closes every route.
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
 * NFTs are on by default and the user can turn them off. The Home NFTs tab
 * renders the gallery content from the journey's own module (exempt below),
 * and the files in `PREVIEW_GATED_ENTRY_POINTS` add an entry only while NFTs
 * are on; the behavioural tests in the wallet-ui suite pin that gate.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isParkedCollectibleView, PARKED_COLLECTIBLE_VIEWS } from "@bramble/wallet-ui/lab";

const WALLET_UI_SRC = join(import.meta.dir, "../../packages/presentation/wallet-ui/src");

// The journey's own modules are exempt: they are the parked code, and they are
// the files a future un-park edits back into reach.
const PARKED_JOURNEY_DIR = join("sidepanel", "journeys", "collectibles");

// Entry points rendered only while NFTs are turned on. Adding a file here is a
// reviewed decision, and its gate needs a test.
const PREVIEW_GATED_ENTRY_POINTS: ReadonlySet<string> = new Set([
  // The gallery tiles' open callback; `navigate` itself refuses every
  // collectible view while NFTs are turned off.
  join("sidepanel", "app", "start.ts"),
]);

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

describe("collectibles entry points", () => {
  test("the view list still names the parked gallery screens", () => {
    // If this changes, the patterns below are checking for the wrong views.
    expect([...PARKED_COLLECTIBLE_VIEWS]).toEqual([
      "nfts",
      "nft-watch",
      "nft-hidden",
      "nft-detail",
      "nft-send",
    ]);
    // On by default; only an explicit "off", or preferences not loaded yet,
    // close the routes, so a stored "off" is never bypassed.
    const isParked = (preferences: Parameters<typeof isParkedCollectibleView>[1]) =>
      PARKED_COLLECTIBLE_VIEWS.map((view) => isParkedCollectibleView(view, preferences));
    expect(isParked({}).some(Boolean)).toBe(false);
    expect(isParked({ collectiblesPreview: true }).some(Boolean)).toBe(false);
    expect(isParked({ collectiblesPreview: false }).every(Boolean)).toBe(true);
    expect(isParked(null).every(Boolean)).toBe(true);
    expect(isParkedCollectibleView("home", null)).toBe(false);
  });

  test("no ungated wallet-ui module renders a route into the gallery", () => {
    const files = sourceFiles(WALLET_UI_SRC);
    // A scan that walked nothing would pass vacuously.
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.flatMap((file) => {
      if (file.startsWith(`${PARKED_JOURNEY_DIR}${sep}`) || PREVIEW_GATED_ENTRY_POINTS.has(file)) {
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
