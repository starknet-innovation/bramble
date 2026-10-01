/**
 * Evaluates the extension's derived surface colours for each skin. The side panel defines them as
 * `color-mix(in srgb, …)` declarations in its stylesheet source; this module reads those exact
 * declarations and computes the mix per skin, so a hover tint or a hairline tuned in the extension
 * reaches the native apps on the next `bun run mobile:assets`.
 */
import { SKIN_TOKENS, type Skin, type SkinToken } from "@bramble/ui-kit/skin";
import { hexRgba, type Rgba } from "./shared";

/** Stylesheet sources the derived colours are declared in, read from disk by the caller. */
export const DERIVED_COLOR_SOURCES = [
  "packages/presentation/wallet-ui/src/sidepanel/styles/core/styles-base.ts",
  "packages/presentation/wallet-ui/src/sidepanel/styles/portfolio/styles-tokens.ts",
] as const;

/** One derived colour: its token name and the mix it is defined by. */
type Mix = {
  readonly name: string;
  readonly from: SkinToken;
  readonly percent: number;
  readonly over: SkinToken | "transparent";
};

const MIX =
  /--bramble-([a-z-]+):\s*color-mix\(in srgb, var\((--bramble-[a-z0-9-]+)\) (\d+(?:\.\d+)?)%, (?:var\((--bramble-[a-z0-9-]+)\)|(transparent))\);/g;

const isSkinToken = (value: string | undefined): value is SkinToken =>
  SKIN_TOKENS.some((token) => token === value);

/**
 * Every `color-mix` declaration whose inputs are skin tokens, in source order. Declarations that
 * mix other derived values are skipped (none exist today), never evaluated with a guess.
 */
export const parseDerivedColors = (sources: readonly string[]): readonly Mix[] => {
  const mixes: Mix[] = [];
  for (const source of sources) {
    for (const match of source.matchAll(MIX)) {
      const [, name, from, percent, over, transparent] = match;
      const base = transparent ? "transparent" : over;
      if (!name || !isSkinToken(from) || !(base === "transparent" || isSkinToken(base))) {
        continue;
      }
      if (!mixes.some((mix) => mix.name === name)) {
        mixes.push({ from, name, over: base, percent: Number(percent) });
      }
    }
  }
  if (mixes.length === 0) {
    throw new Error("No derived colours found; the stylesheet shape changed");
  }
  return mixes;
};

/** `color-mix(in srgb, A p%, B)`: premultiplied interpolation, as browsers compute it. */
export const mix = (a: Rgba, p: number, b: Rgba): Rgba => {
  const alpha = a.a * p + b.a * (1 - p);
  if (alpha === 0) {
    return { a: 0, b: 0, g: 0, r: 0 };
  }
  const channel = (x: number, y: number): number => (x * a.a * p + y * b.a * (1 - p)) / alpha;
  return { a: alpha, b: channel(a.b, b.b), g: channel(a.g, b.g), r: channel(a.r, b.r) };
};

/** The derived colours evaluated for one skin, keyed by token name. */
export const evaluateDerived = (skin: Skin, mixes: readonly Mix[]): ReadonlyMap<string, Rgba> =>
  new Map(
    mixes.map((m) => [
      m.name,
      mix(
        hexRgba(skin.tokens[m.from]),
        m.percent / 100,
        m.over === "transparent" ? { a: 0, b: 0, g: 0, r: 0 } : hexRgba(skin.tokens[m.over]),
      ),
    ]),
  );
