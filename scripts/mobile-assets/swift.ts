/**
 * Renders `BrambleTokens.generated.swift`: skins (base and derived colours), the scale, motion,
 * spring and shadow tokens, and the icon / token-logo catalogues.
 */
import { darkSkin } from "@bramble/ui-kit/dark-skin";
import { defaultSkin } from "@bramble/ui-kit/default-skin";
import { SKIN_TOKENS, type Skin } from "@bramble/ui-kit/skin";
import {
  CONTROL,
  EASE,
  MOTION,
  RADIUS,
  SHADOW,
  SIZE,
  SPACE,
  SPRING,
  TRACKING,
  TYPE,
  WEIGHT,
} from "@bramble/ui-kit/tokens";
import { evaluateDerived, type parseDerivedColors } from "./colors";
import {
  argbHex,
  bezier,
  camel,
  em,
  HEADER,
  hexRgba,
  px,
  shadow,
  sorted,
  swiftName,
} from "./shared";
import { swiftIconEnum, tokenLogoAddresses, tokenLogoAssetName } from "./vectors";

type Mixes = ReturnType<typeof parseDerivedColors>;

const colorFields = (mixes: Mixes): readonly string[] => [
  ...SKIN_TOKENS.map(camel),
  ...mixes.map((m) => camel(`--bramble-${m.name}`)),
];

const skinValue = (skin: Skin, name: string, mixes: Mixes): string => {
  const derived = evaluateDerived(skin, mixes);
  const values = [
    ...SKIN_TOKENS.map((token) => argbHex(hexRgba(skin.tokens[token]))),
    ...mixes.map((m) => {
      const color = derived.get(m.name);
      if (!color) {
        throw new Error(`Derived colour ${m.name} did not evaluate`);
      }
      return argbHex(color);
    }),
  ];
  const fields = colorFields(mixes);
  return [
    `    static let ${name} = BrambleSkin(`,
    `        name: "${skin.name}",`,
    ...fields.map(
      (field, index) =>
        `        ${field}: Color(argb: ${values[index]})${index === fields.length - 1 ? "" : ","}`,
    ),
    "    )",
  ].join("\n");
};

const scale = (name: string, record: Readonly<Record<string, string>>): string[] => [
  `enum ${name} {`,
  ...sorted(record).map(
    ([key, value]) => `    static let ${swiftName(key)}: CGFloat = ${px(value)}`,
  ),
  "}",
  "",
];

/** The Swift token file. */
export const renderSwift = (mixes: Mixes): string =>
  [
    `// ${HEADER}`,
    "import SwiftUI",
    "",
    "/// Skin contract from `ui-kit/src/theme/skin.ts`, plus the side panel's derived `color-mix`",
    "/// surfaces evaluated per skin (`styles-base.ts`, `styles-tokens.ts`).",
    "struct BrambleSkin: Equatable {",
    "    let name: String",
    ...colorFields(mixes).map((field) => `    let ${field}: Color`),
    "}",
    "",
    "extension BrambleSkin {",
    skinValue(defaultSkin, "daylight", mixes),
    "",
    skinValue(darkSkin, "midnight", mixes),
    "}",
    "",
    "/// Scale tokens from `ui-kit/src/theme/tokens.ts`.",
    ...scale("BrambleSpace", SPACE),
    ...scale("BrambleRadius", RADIUS),
    ...scale("BrambleControl", CONTROL),
    ...scale("BrambleSize", SIZE),
    "enum BrambleTypeScale {",
    ...sorted(TYPE).map(
      ([key, value]) =>
        `    static let ${key} = BrambleTypeStyle(size: ${px(value.size)}, lineHeight: ${value.line})`,
    ),
    "}",
    "",
    "/// CSS font-weight numbers; `BrambleTheme` maps them onto platform weights.",
    "enum BrambleWeight {",
    ...sorted(WEIGHT).map(([key, value]) => `    static let ${key} = ${value}`),
    "}",
    "",
    "/// Letter-spacing in em; multiply by the point size for kerning.",
    "enum BrambleTracking {",
    ...sorted(TRACKING).map(([key, value]) => `    static let ${key}: CGFloat = ${em(value)}`),
    "}",
    "",
    "enum BrambleMotion {",
    ...sorted(MOTION)
      .filter(([key]) => key.endsWith("Ms"))
      .map(([key, value]) => `    static let ${key}: Double = ${value}`),
    "}",
    "",
    "enum BrambleEase {",
    ...sorted(EASE).map(
      ([key, value]) => `    static let ${key} = BrambleBezier(${bezier(value).join(", ")})`,
    ),
    "}",
    "",
    "enum BrambleSpring {",
    ...sorted(SPRING).map(
      ([key, value]) =>
        `    static let ${swiftName(key)} = Animation.spring(response: ${value.response}, dampingFraction: ${value.damping})`,
    ),
    "}",
    "",
    "enum BrambleShadow {",
    ...sorted(SHADOW).map(([key, value]) => {
      const { alpha, blur, y } = shadow(value);
      return `    static let ${key} = BrambleShadowStyle(y: ${y}, blur: ${blur}, alpha: ${alpha})`;
    }),
    "}",
    "",
    swiftIconEnum(),
    "",
    "/// Bundled token logos from `portfolio/src/tokens/token-logos.ts`, keyed by 64-digit address.",
    "enum BrambleTokenLogo {",
    "    static let assets: [String: String] = [",
    ...tokenLogoAddresses().map(
      (address) => `        "${address}": "Tokens/${tokenLogoAssetName(address)}",`,
    ),
    "    ]",
    "}",
    "",
  ].join("\n");
