/**
 * Renders the extension's vector artwork for the native apps: the 59 stroke icons (from
 * `ui-kit/icons`), the wordmark (from `ui-kit/brand-mark`), and the bundled token logos (from
 * `portfolio/token-logos`). iOS receives each as an SVG in an asset catalog; Android receives a
 * vector drawable, which only understands `<path>`, so basic shapes are converted to exact path
 * data here rather than approximated.
 */

import { tokenLogoSvg } from "@bramble/portfolio/token-logos";
import { BRAMBLE_WORDMARK, BRAMBLE_WORDMARK_VIEW_BOX } from "@bramble/ui-kit/brand-mark";
import { ICON_NAMES, icon } from "@bramble/ui-kit/icons";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
import { HEADER, snake } from "./shared";

const XCASSETS = "mobile/ios/Bramble/Resources/Assets.xcassets";
const ANDROID_DRAWABLE = "mobile/android/app/src/main/res/drawable";
/** Stroke width of `.icon` in `styles-components.ts`. */
const ICON_STROKE = 1.8;

type Element = { readonly tag: string; readonly attrs: Readonly<Record<string, string>> };

const elements = (markup: string): readonly Element[] =>
  [...markup.matchAll(/<(path|circle|rect|line|polygon|polyline)\s([^>]*?)\/?>/g)].map((match) => ({
    attrs: Object.fromEntries(
      [...(match[2] ?? "").matchAll(/([a-z-]+)="([^"]*)"/g)].map((a) => [a[1] ?? "", a[2] ?? ""]),
    ),
    tag: match[1] ?? "",
  }));

const n = (attrs: Readonly<Record<string, string>>, key: string, fallback = 0): number =>
  attrs[key] === undefined ? fallback : Number(attrs[key]);

const points = (value: string): string[] => {
  const numbers = value.trim().split(/[\s,]+/);
  const pairs: string[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    pairs.push(`${numbers[index]},${numbers[index + 1]}`);
  }
  return pairs;
};

/** Exact path data for one SVG basic shape (shared with `android-token-logos.ts`). */
export const pathData = ({ tag, attrs }: Element): string => {
  switch (tag) {
    case "path":
      return attrs["d"] ?? "";
    case "circle": {
      const [cx, cy, r] = [n(attrs, "cx"), n(attrs, "cy"), n(attrs, "r")];
      return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
    }
    case "rect": {
      const [x, y, w, h] = [n(attrs, "x"), n(attrs, "y"), n(attrs, "width"), n(attrs, "height")];
      const rx = Math.min(n(attrs, "rx", n(attrs, "ry")), w / 2);
      const ry = Math.min(n(attrs, "ry", rx), h / 2);
      if (rx === 0 && ry === 0) {
        return `M${x},${y}h${w}v${h}h${-w}z`;
      }
      return [
        `M${x + rx},${y}h${w - 2 * rx}a${rx},${ry} 0 0,1 ${rx},${ry}v${h - 2 * ry}`,
        `a${rx},${ry} 0 0,1 ${-rx},${ry}h${-(w - 2 * rx)}a${rx},${ry} 0 0,1 ${-rx},${-ry}`,
        `v${-(h - 2 * ry)}a${rx},${ry} 0 0,1 ${rx},${-ry}z`,
      ].join("");
    }
    case "line":
      return `M${n(attrs, "x1")},${n(attrs, "y1")}L${n(attrs, "x2")},${n(attrs, "y2")}`;
    case "polygon":
      return `M${points(attrs["points"] ?? "").join("L")}z`;
    case "polyline":
      return `M${points(attrs["points"] ?? "").join("L")}`;
    default:
      throw new Error(`Unsupported icon element <${tag}>`);
  }
};

const iconBody = (name: (typeof ICON_NAMES)[number]): string => {
  const match = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(icon(name));
  if (!match?.[1]) {
    throw new Error(`Icon ${name} did not render as an <svg>`);
  }
  return match[1];
};

const imageset = (
  dir: string,
  file: string,
  svg: string,
  template: boolean,
): [string, string][] => [
  [`${dir}/${file}`, svg],
  [
    `${dir}/Contents.json`,
    `${JSON.stringify(
      {
        images: [{ filename: file, idiom: "universal" }],
        info: { author: "xcode", version: 1 },
        properties: {
          "preserves-vector-representation": true,
          "template-rendering-intent": template ? "template" : "original",
        },
      },
      null,
      2,
    )}\n`,
  ],
];

const folder = (dir: string): [string, string] => [
  `${dir}/Contents.json`,
  `${JSON.stringify({ info: { author: "xcode", version: 1 }, properties: { "provides-namespace": true } }, null, 2)}\n`,
];

const iosIcon = (name: (typeof ICON_NAMES)[number]): [string, string][] => {
  const body = iconBody(name).replaceAll('fill="currentColor"', 'fill="#000000"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round"><title>${name}</title>${body}</svg>\n`;
  return imageset(`${XCASSETS}/Icons/${name}.imageset`, `${name}.svg`, svg, true);
};

const androidIcon = (name: (typeof ICON_NAMES)[number]): [string, string] => {
  const paths = elements(iconBody(name)).map((element) => {
    const filled = element.attrs["fill"] === "currentColor";
    return [
      "    <path",
      `        android:pathData="${pathData(element)}"`,
      filled ? '        android:fillColor="#FF000000"' : '        android:fillColor="#00000000"',
      '        android:strokeColor="#FF000000"',
      `        android:strokeWidth="${ICON_STROKE}"`,
      '        android:strokeLineCap="round"',
      '        android:strokeLineJoin="round" />',
    ].join("\n");
  });
  return [
    `${ANDROID_DRAWABLE}/ic_${snake(name)}.xml`,
    [
      `<!-- ${HEADER} -->`,
      '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
      '    android:width="24dp"',
      '    android:height="24dp"',
      '    android:viewportWidth="24"',
      '    android:viewportHeight="24">',
      ...paths,
      "</vector>",
      "",
    ].join("\n"),
  ];
};

const wordmarkSize = (): [string, string] => {
  const [, , width, height] = BRAMBLE_WORDMARK_VIEW_BOX.split(" ");
  if (!width || !height) {
    throw new Error("Wordmark view box must be four numbers");
  }
  return [width, height];
};

const wordmarkGroups = (): readonly { x: string; y: string; d: string }[] =>
  [
    ...BRAMBLE_WORDMARK.matchAll(
      /<g transform="translate\(([\d.-]+) ([\d.-]+)\)"><path d="([^"]+)"/g,
    ),
  ].map((match) => ({ d: match[3] ?? "", x: match[1] ?? "0", y: match[2] ?? "0" }));

const iosWordmark = (): [string, string][] => {
  const [width, height] = wordmarkSize();
  const groups = wordmarkGroups()
    .map((g) => `<g transform="translate(${g.x} ${g.y})"><path fill="#000000" d="${g.d}"/></g>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${BRAMBLE_WORDMARK_VIEW_BOX}"><title>Bramble</title>${groups}</svg>\n`;
  return imageset(`${XCASSETS}/BrandWordmark.imageset`, "wordmark.svg", svg, true);
};

const androidWordmark = (): [string, string] => {
  const [width, height] = wordmarkSize();
  const groups = wordmarkGroups().map((g) =>
    [
      `    <group android:translateX="${g.x}" android:translateY="${g.y}">`,
      `        <path android:fillColor="#FF000000" android:pathData="${g.d}" />`,
      "    </group>",
    ].join("\n"),
  );
  return [
    `${ANDROID_DRAWABLE}/brand_wordmark.xml`,
    [
      `<!-- ${HEADER} -->`,
      '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
      `    android:width="${width}dp"`,
      `    android:height="${height}dp"`,
      `    android:viewportWidth="${width}"`,
      `    android:viewportHeight="${height}">`,
      ...groups,
      "</vector>",
      "",
    ].join("\n"),
  ];
};

/** Asset-catalog name of a bundled token logo, keyed by the 64-digit address. */
export const tokenLogoAssetName = (address: string): string =>
  `token-${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

// iOS takes each logo as an SVG; Android's vector drawables are rendered from the same SVGs by
// `android-token-logos.ts`.
const iosTokenLogos = (): [string, string][] =>
  [...new Map(DEFAULT_TOKENS.map((token) => [token.address, token.symbol])).entries()].flatMap(
    ([address, symbol]) => {
      const svg = tokenLogoSvg(address);
      if (svg === null) {
        return [];
      }
      const clean = svg
        .replace(/ class="token-logo"/, "")
        .replace(/ aria-hidden="true"/, "")
        .replace(/^(<svg[^>]*>)/, `$1<title>${symbol}</title>`);
      return imageset(
        `${XCASSETS}/Tokens/${tokenLogoAssetName(address)}.imageset`,
        "logo.svg",
        `${clean}\n`,
        false,
      );
    },
  );

/** Addresses (64-digit, lowercase) that ship a bundled logo. */
export const tokenLogoAddresses = (): readonly string[] =>
  [...new Set(DEFAULT_TOKENS.map((token) => token.address))]
    .filter((address) => tokenLogoSvg(address) !== null)
    .map((address) => tokenLogoAssetName(address).replace(/^token-/, "0x"));

/** Swift enum of every icon, so a screen can only name an icon the extension ships. */
export const swiftIconEnum = (): string =>
  [
    "/// Every stroke icon in `ui-kit/src/components/icons.ts`, as asset-catalog names.",
    "enum BrambleIconName: String, CaseIterable {",
    ...ICON_NAMES.map((name) => `    case ${name} = "Icons/${name}"`),
    "}",
  ].join("\n");

/** Kotlin enum of every icon, bound to its generated vector drawable. */
export const kotlinIconEnum = (): string =>
  [
    "/** Every stroke icon in `ui-kit/src/components/icons.ts`, bound to its vector drawable. */",
    "enum class BrambleIconName(@DrawableRes val drawable: Int) {",
    ...ICON_NAMES.map((name) => `    ${snake(name).toUpperCase()}(R.drawable.ic_${snake(name)}),`),
    "}",
  ].join("\n");

/** Every generated vector asset, keyed by repository-relative path. */
export const renderVectorAssets = (): [string, string][] => [
  folder(`${XCASSETS}/Icons`),
  ...ICON_NAMES.flatMap(iosIcon),
  ...ICON_NAMES.map(androidIcon),
  ...iosWordmark(),
  androidWordmark(),
  folder(`${XCASSETS}/Tokens`),
  ...iosTokenLogos(),
];
