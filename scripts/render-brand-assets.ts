/**
 * Renders the extension's toolbar/store icon PNGs and the store promo PNG from
 * the website's vector mark, so the extension, the side panel's inline brand
 * mark, the store artwork, and the website all draw the same bird from one
 * source file.
 *
 * Source: `apps/website/public/brand/mark.svg` (the site favicon). Icon
 * composition follows the previous artwork — the website's cream ground, its
 * ink for the bird, no rounding (Chrome masks the icon itself). Output:
 *
 *   apps/extension/public/icons/icon-{16,24,32,48,128}.png
 *   docs/chrome-web-store/assets/icon.svg              (the composed icon vector)
 *   docs/chrome-web-store/assets/icon-128.png          (store listing copy)
 *   docs/chrome-web-store/assets/promo-small-source.svg (its `#mark` path refreshed)
 *   docs/chrome-web-store/assets/promo-small-440x280.png
 *
 * Rasterised with the Playwright Chromium already installed for the E2E suite
 * (`bun run test:e2e:install`), one page per size so every PNG is a crisp
 * integer render rather than a downscale. Run: `bun run scripts/render-brand-assets.ts`.
 * Trusted inputs only: this reads checked-in SVGs and writes checked-in files.
 */
import { readFile, writeFile } from "node:fs/promises";
import { type Browser, chromium } from "@playwright/test";

const SOURCE = "apps/website/public/brand/mark.svg";
const ICON_DIR = "apps/extension/public/icons";
const STORE_DIR = "docs/chrome-web-store/assets";
const PROMO_SOURCE = `${STORE_DIR}/promo-small-source.svg`;
const ICON_SIZES = [16, 24, 32, 48, 128] as const;
const PROMO = { height: 280, width: 440 } as const;

// Website palette (apps/website/DESIGN.md): cream ground, ink mark.
const GROUND = "#fff5ec";
const INK = "#282729";
// Fraction of the icon box the mark's width occupies; centred both ways.
const MARK_WIDTH_RATIO = 0.78;
const BOX = 128;

const round = (value: number): string => value.toFixed(4).replace(/\.?0+$/, "");

const readMark = async (): Promise<{ path: string; width: number; height: number }> => {
  const source = await readFile(SOURCE, "utf8");
  const path = /<path d="([^"]+)"/.exec(source)?.[1]?.replace(/\s+/g, " ").trim();
  const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1];
  if (path === undefined || viewBox === undefined) {
    throw new Error(`${SOURCE}: expected one <path d> and a viewBox`);
  }
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  if (width === undefined || height === undefined || !(width > 0) || !(height > 0)) {
    throw new Error(`${SOURCE}: viewBox must be four numbers`);
  }
  return { height, path, width };
};

const composeIcon = (mark: { path: string; width: number; height: number }): string => {
  const scale = (BOX * MARK_WIDTH_RATIO) / mark.width;
  const offsetX = (BOX - mark.width * scale) / 2;
  const offsetY = (BOX - mark.height * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" width="${BOX}" height="${BOX}" role="img" aria-label="Bramble">
  <title>Bramble icon</title>
  <rect width="${BOX}" height="${BOX}" fill="${GROUND}"/>
  <path fill="${INK}" fill-rule="nonzero" transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale)})" d="${mark.path}"/>
</svg>
`;
};

// Refresh only the mark's path data inside the hand-authored promo, leaving its
// placement transform and everything else to the source file.
const refreshPromo = async (markPath: string): Promise<string> => {
  const promo = await readFile(PROMO_SOURCE, "utf8");
  const pattern = /(<path id="mark"[^>]*\sd=")([^"]+)(")/;
  if (!pattern.test(promo)) {
    throw new Error(`${PROMO_SOURCE}: expected a <path id="mark" … d="…"> element`);
  }
  const refreshed = promo.replace(pattern, `$1${markPath}$3`);
  await writeFile(PROMO_SOURCE, refreshed);
  return refreshed;
};

const renderSvg = async (
  browser: Browser,
  svg: string,
  size: { width: number; height: number },
  background: string,
): Promise<Buffer> => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: size });
  try {
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:${background}"><div style="width:${size.width}px;height:${size.height}px">${svg.replace(
        /<svg /,
        `<svg width="${size.width}" height="${size.height}" style="display:block" `,
      )}</div></body></html>`,
    );
    return await page.screenshot({
      clip: { height: size.height, width: size.width, x: 0, y: 0 },
      omitBackground: background === "transparent",
      type: "png",
    });
  } finally {
    await page.close();
  }
};

const mark = await readMark();
const iconSvg = composeIcon(mark);
await writeFile(`${STORE_DIR}/icon.svg`, iconSvg);
const promoSvg = await refreshPromo(mark.path);

const browser = await chromium.launch();
try {
  for (const size of ICON_SIZES) {
    const png = await renderSvg(browser, iconSvg, { height: size, width: size }, GROUND);
    await writeFile(`${ICON_DIR}/icon-${size}.png`, png);
    if (size === BOX) {
      await writeFile(`${STORE_DIR}/icon-128.png`, png);
    }
  }
  const promoPng = await renderSvg(browser, promoSvg, PROMO, "transparent");
  await writeFile(`${STORE_DIR}/promo-small-${PROMO.width}x${PROMO.height}.png`, promoPng);
} finally {
  await browser.close();
}
console.log(`rendered icons (${ICON_SIZES.join(", ")}px) and the store promo from ${SOURCE}`);
