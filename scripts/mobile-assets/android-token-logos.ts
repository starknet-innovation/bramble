/**
 * Renders the extension's bundled token logos (`portfolio/token-logos`) as Android vector
 * drawables, plus the Kotlin map the token row reads them through. The logos use solid fills,
 * `fill-rule`, `fill-opacity`, basic shapes, and `<g>` fill inheritance, and each of those has an
 * exact vector-drawable spelling (`fillColor`, `fillType`, `fillAlpha`, path data), so the
 * conversion is lossless. Anything else (gradients, clip paths, transforms, strokes, group
 * opacity) fails generation instead of being dropped, and the row would then need its letter
 * badge again.
 */
import { tokenLogoSvg } from "@bramble/portfolio/token-logos";
import { DEFAULT_TOKENS } from "@bramble/wallet-model/networks";
import { HEADER } from "./shared";
import { pathData, tokenLogoAssetName } from "./vectors";

const ANDROID_DRAWABLE = "mobile/android/app/src/main/res/drawable";
/** Repository-relative path of the Kotlin token-logo map. */
const KOTLIN_TOKEN_LOGOS_PATH =
  "mobile/android/app/src/main/java/org/bramble/wallet/design/BrambleTokenLogos.generated.kt";

/** Presentation attributes a drawable can carry, resolved through `<g>` inheritance. */
const INHERITED = ["fill", "fill-rule", "fill-opacity"] as const;
/** Attributes with no effect on a solid-filled shape that has no clip path applied to it. */
const INERT = new Set(["clip-rule", "cx", "cy", "d", "r", "x", "y", "width", "height", "rx", "ry"]);

type Attrs = Readonly<Record<string, string>>;
type Tag = {
  readonly attrs: Attrs;
  readonly close: boolean;
  readonly name: string;
  readonly selfClosing: boolean;
};

const tags = (svg: string): readonly Tag[] =>
  [...svg.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z:-]+="[^"]*")*)\s*(\/?)>/g)].map((match) => ({
    attrs: Object.fromEntries(
      [...(match[3] ?? "").matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((a) => [
        a[1] ?? "",
        a[2] ?? "",
      ]),
    ),
    close: match[1] === "/",
    name: match[2] ?? "",
    selfClosing: match[4] === "/",
  }));

/** `#abc` / `#aabbcc` as the drawable's `#AARRGGBB`. */
const drawableColor = (value: string): string => {
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(value);
  const hex = short
    ? `${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
    : value.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Token logo fill must be a hex colour, got ${value}`);
  }
  return `#FF${hex.toUpperCase()}`;
};

const checkSupported = (tag: Tag): void => {
  for (const key of Object.keys(tag.attrs)) {
    if (tag.name === "svg" || (INHERITED as readonly string[]).includes(key) || INERT.has(key)) {
      continue;
    }
    throw new Error(`Token logo attribute ${key} on <${tag.name}> has no exact drawable form`);
  }
};

const viewBox = (svg: Attrs): readonly [string, string, string, string] => {
  const parts = (svg["viewBox"] ?? "").trim().split(/\s+/);
  const [x, y, w, h] = parts;
  if (parts.length !== 4 || x !== "0" || y !== "0" || !w || !h) {
    throw new Error("Token logo view box must start at the origin");
  }
  return [svg["width"] ?? w, svg["height"] ?? h, w, h];
};

/** One logo SVG as a vector drawable, shape by shape, with inherited fills resolved. */
const tokenLogoDrawable = (svg: string): string => {
  const stack: Record<string, string>[] = [{}];
  const paths: string[] = [];
  let size: readonly [string, string, string, string] | null = null;
  for (const tag of tags(svg)) {
    if (tag.name === "title") {
      continue;
    }
    if (tag.close) {
      if (tag.name === "g") stack.pop();
      continue;
    }
    checkSupported(tag);
    const inherited = { ...stack[stack.length - 1] };
    for (const key of INHERITED) {
      const value = tag.attrs[key];
      if (value !== undefined) inherited[key] = value;
    }
    if (tag.name === "svg") {
      size = viewBox(tag.attrs);
      stack.push(inherited);
    } else if (tag.name === "g") {
      if (!tag.selfClosing) stack.push(inherited);
    } else if (tag.name === "path" || tag.name === "circle" || tag.name === "rect") {
      const fill = inherited["fill"] ?? "#000000";
      if (fill === "none") continue;
      const alpha = inherited["fill-opacity"];
      paths.push(
        [
          "    <path",
          `        android:pathData="${pathData({ attrs: tag.attrs, tag: tag.name })}"`,
          `        android:fillColor="${drawableColor(fill)}"`,
          ...(alpha === undefined ? [] : [`        android:fillAlpha="${Number(alpha)}"`]),
          `        android:fillType="${inherited["fill-rule"] === "evenodd" ? "evenOdd" : "nonZero"}" />`,
        ].join("\n"),
      );
    } else {
      throw new Error(`Token logo element <${tag.name}> has no exact drawable form`);
    }
  }
  if (!size) {
    throw new Error("Token logo is not an <svg>");
  }
  const [width, height, viewportWidth, viewportHeight] = size;
  return [
    `<!-- ${HEADER} -->`,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    `    android:width="${width}dp"`,
    `    android:height="${height}dp"`,
    `    android:viewportWidth="${viewportWidth}"`,
    `    android:viewportHeight="${viewportHeight}">`,
    ...paths,
    "</vector>",
    "",
  ].join("\n");
};

/** Android resource name of a logo: `token_` plus the 64-digit lowercase address. */
const drawableName = (address: string): string => tokenLogoAssetName(address).replace("-", "_");

const logos = (): readonly (readonly [string, string])[] =>
  [...new Map(DEFAULT_TOKENS.map((token) => [token.address, token.address])).keys()].flatMap(
    (address) => {
      const svg = tokenLogoSvg(address);
      return svg === null ? [] : [[address, svg] as const];
    },
  );

const kotlinMap = (): string =>
  [
    `// ${HEADER}`,
    "package org.bramble.wallet.design",
    "",
    "import org.bramble.wallet.R",
    "",
    "/** Bundled token logos from `portfolio/src/tokens/token-logos.ts`, keyed by 64-digit address. */",
    "object BrambleTokenLogos {",
    "    val drawables: Map<String, Int> = mapOf(",
    ...logos().map(
      ([address]) =>
        `        "${tokenLogoAssetName(address).replace(/^token-/, "0x")}" to R.drawable.${drawableName(address)},`,
    ),
    "    )",
    "}",
    "",
  ].join("\n");

/** Every Android token-logo file, keyed by repository-relative path. */
export const renderAndroidTokenLogos = (): [string, string][] => [
  ...logos().map(([address, svg]): [string, string] => [
    `${ANDROID_DRAWABLE}/${drawableName(address)}.xml`,
    tokenLogoDrawable(svg),
  ]),
  [KOTLIN_TOKEN_LOGOS_PATH, kotlinMap()],
];
