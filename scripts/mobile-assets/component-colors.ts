/**
 * Colours a component declares inline as a `color-mix()` in the side panel's rendered stylesheet
 * (for example the action tile's pressed fill, which mixes the accent over the derived accent-soft
 * surface). Each is evaluated per skin with the same premultiplied mix as the derived surfaces, so
 * the pressed tint on a phone is the one the extension paints.
 */
import { SKIN_TOKENS, type Skin, type SkinToken } from "@bramble/ui-kit/skin";
import { evaluateDerived, mix, type parseDerivedColors } from "./colors";
import { type CssRule, declaredValue, rootProperties } from "./css";
import { hexRgba, type Rgba } from "./shared";

/** Skin field name → the selector and property whose `color-mix()` it mirrors. */
export const COMPONENT_COLORS: Readonly<Record<string, readonly [string, string]>> = {
  actionTilePress: [".action-tile:not(:disabled):active", "background"],
  ...Object.fromEntries(
    [0, 1, 2, 3].flatMap((tone) => [
      [`tokenMark${tone}Fill`, [`.token-mark[data-tone="${tone}"]`, "background"]],
      [`tokenMark${tone}Ink`, [`.token-mark[data-tone="${tone}"]`, "color"]],
    ]),
  ),
};

/** `hsl(h s% l%)`, the shape the stylesheet's constant `:root` colours use. */
const hsl = (value: string): Rgba | null => {
  const match = /^hsl\((\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%\)$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number): number => {
    const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0;
    const v =
      t < 1 / 6
        ? p + (q - p) * 6 * t
        : t < 1 / 2
          ? q
          : t < 2 / 3
            ? p + (q - p) * (2 / 3 - t) * 6
            : p;
    return v * 255;
  };
  return { a: 1, b: channel(h - 1 / 3), g: channel(h), r: channel(h + 1 / 3) };
};

const MIX =
  /^color-mix\(in srgb, var\(--bramble-([a-z0-9-]+)\) (\d+(?:\.\d+)?)%, (?:var\(--bramble-([a-z0-9-]+)\)|(transparent))\)$/;

const isSkinToken = (value: string): value is SkinToken =>
  SKIN_TOKENS.some((token) => token === value);

/** Evaluates every listed component colour for one skin, in table order. */
export const evaluateComponentColors = (
  rules: readonly CssRule[],
  skin: Skin,
  mixes: ReturnType<typeof parseDerivedColors>,
): readonly (readonly [string, Rgba])[] => {
  const derived = evaluateDerived(skin, mixes);
  const root = rootProperties(rules);
  const operand = (name: string): Rgba => {
    const token = `--bramble-${name}`;
    if (isSkinToken(token)) return hexRgba(skin.tokens[token]);
    const value = derived.get(name) ?? hsl(root.get(token) ?? "");
    if (!value) {
      throw new Error(
        `Colour operand ${token} is not a skin token, derived colour, or hsl() constant`,
      );
    }
    return value;
  };
  return Object.entries(COMPONENT_COLORS).map(([field, [selector, property]]) => {
    const value = declaredValue(rules, selector, property);
    const match = value === undefined ? null : MIX.exec(value);
    if (!match?.[1] || !match[2]) {
      throw new Error(`${selector} ${property} is not a supported color-mix(): ${value}`);
    }
    const over = match[4] ? { a: 0, b: 0, g: 0, r: 0 } : operand(match[3] ?? "");
    return [field, mix(operand(match[1]), Number(match[2]) / 100, over)] as const;
  });
};
