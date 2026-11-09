/**
 * The Bramble mark has one vector source — the website's `mark.svg`. The
 * side panel's inline mark (`@bramble/ui-kit/brand-mark`), the composed
 * extension icon, and the store promo all copy its path data; this pins them
 * so a redraw in one place cannot leave the others showing an older bird.
 * Re-render with `bun run scripts/render-brand-assets.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAMBLE_MARK,
  BRAMBLE_MARK_PATH,
  BRAMBLE_MARK_VIEW_BOX,
  BRAMBLE_WORDMARK,
  BRAMBLE_WORDMARK_VIEW_BOX,
} from "@bramble/ui-kit/brand-mark";

const root = join(import.meta.dir, "../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

const pathData = (svg: string, selector = "<path"): string => {
  const start = svg.indexOf(selector);
  expect(start, `${selector} present`).toBeGreaterThanOrEqual(0);
  const match = /\sd="([^"]+)"/.exec(svg.slice(start));
  expect(match).not.toBeNull();
  return (match?.[1] ?? "").replace(/\s+/g, " ").trim();
};

describe("brand mark single source", () => {
  const website = read("apps/website/public/brand/mark.svg");

  test("the inline mark copies the website's path and viewBox", () => {
    expect(BRAMBLE_MARK_PATH).toBe(pathData(website));
    expect(/viewBox="([^"]+)"/.exec(website)?.[1]).toBe(BRAMBLE_MARK_VIEW_BOX);
    expect(BRAMBLE_MARK).toContain(`viewBox="${BRAMBLE_MARK_VIEW_BOX}"`);
    expect(BRAMBLE_MARK).toContain('fill="currentColor"');
    expect(BRAMBLE_MARK).toContain('aria-hidden="true"');
  });

  test("the inline wordmark copies every path of the website's lockup", () => {
    const website = read("apps/website/public/brand/wordmark.svg");
    const paths = (svg: string): string[] =>
      [...svg.matchAll(/\sd="([^"]+)"/g)].map(
        (match) => match[1]?.replace(/\s+/g, " ").trim() ?? "",
      );
    expect(paths(BRAMBLE_WORDMARK)).toEqual(paths(website));
    expect(paths(BRAMBLE_WORDMARK).length).toBeGreaterThan(1);
    expect(/viewBox="([^"]+)"/.exec(website)?.[1]).toBe(BRAMBLE_WORDMARK_VIEW_BOX);
    // Ink follows the surrounding text colour; the website's fixed ink never leaks in.
    expect(BRAMBLE_WORDMARK).not.toContain("#282729");
    expect(BRAMBLE_WORDMARK).toContain('role="img" aria-label="Bramble"');
  });

  test("the website favicon is the mark", () => {
    expect(read("apps/website/public/favicon.svg")).toBe(website);
  });

  test("the composed extension icon and the store promo carry the same path", () => {
    expect(pathData(read("docs/chrome-web-store/assets/icon.svg"))).toBe(BRAMBLE_MARK_PATH);
    expect(
      pathData(read("docs/chrome-web-store/assets/promo-small-source.svg"), '<path id="mark"'),
    ).toBe(BRAMBLE_MARK_PATH);
  });

  test("the icon and store copies of the 128px render are byte-identical", () => {
    const shipped = readFileSync(join(root, "apps/extension/public/icons/icon-128.png"));
    const listing = readFileSync(join(root, "docs/chrome-web-store/assets/icon-128.png"));
    expect(shipped.equals(listing)).toBe(true);
  });
});
