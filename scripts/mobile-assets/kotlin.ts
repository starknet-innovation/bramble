/**
 * Renders `BrambleTokens.generated.kt`: the Compose twin of the Swift token file.
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
import { argbHex, bezier, camel, em, HEADER, hexRgba, px, shadow, sorted } from "./shared";
import { kotlinIconEnum } from "./vectors";

type Mixes = ReturnType<typeof parseDerivedColors>;

const fields = (mixes: Mixes): readonly string[] => [
  ...SKIN_TOKENS.map(camel),
  ...mixes.map((m) => camel(`--bramble-${m.name}`)),
];

const skinValue = (skin: Skin, name: string, mixes: Mixes): string => {
  const derived = evaluateDerived(skin, mixes);
  const values = [
    ...SKIN_TOKENS.map((token) => argbHex(hexRgba(skin.tokens[token]))),
    ...mixes.map((m) => argbHex(derived.get(m.name) ?? hexRgba("#000000"))),
  ];
  return [
    `    val ${name} = BrambleSkin(`,
    `        name = "${skin.name}",`,
    ...fields(mixes).map((field, index) => `        ${field} = Color(${values[index]}),`),
    "    )",
  ].join("\n");
};

const obj = (name: string, entries: string[]): string[] => [
  `object ${name} {`,
  ...entries,
  "}",
  "",
];

/** The Kotlin token file. */
export const renderKotlin = (mixes: Mixes): string =>
  `${[
    `// ${HEADER}`,
    "package org.bramble.wallet.design",
    "",
    "import androidx.annotation.DrawableRes",
    "import androidx.compose.animation.core.CubicBezierEasing",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.unit.dp",
    "import androidx.compose.ui.unit.sp",
    "import org.bramble.wallet.R",
    "",
    "/** Skin contract plus the side panel's derived `color-mix` surfaces, evaluated per skin. */",
    "data class BrambleSkin(",
    "    val name: String,",
    ...fields(mixes).map((field) => `    val ${field}: Color,`),
    ")",
    "",
    ...obj("BrambleSkins", [
      skinValue(defaultSkin, "daylight", mixes),
      "",
      skinValue(darkSkin, "midnight", mixes),
    ]),
    ...obj(
      "BrambleSpace",
      sorted(SPACE).map(([k, v]) => `    val ${k} = ${px(v)}.dp`),
    ),
    ...obj(
      "BrambleRadius",
      sorted(RADIUS).map(([k, v]) => `    val ${k} = ${px(v)}.dp`),
    ),
    ...obj(
      "BrambleControl",
      sorted(CONTROL).map(([k, v]) => `    val ${k} = ${px(v)}.dp`),
    ),
    ...obj(
      "BrambleSize",
      sorted(SIZE).map(([k, v]) => `    val ${k} = ${px(v)}.dp`),
    ),
    ...obj(
      "BrambleTypeScale",
      sorted(TYPE).map(
        ([k, v]) =>
          `    val ${k} = BrambleTypeStyle(size = ${px(v.size)}.sp, lineHeight = ${v.line}f)`,
      ),
    ),
    ...obj(
      "BrambleWeight",
      sorted(WEIGHT).map(([k, v]) => `    const val ${k} = ${v}`),
    ),
    ...obj(
      "BrambleTracking",
      sorted(TRACKING).map(([k, v]) => `    const val ${k} = ${em(v)}f`),
    ),
    ...obj(
      "BrambleMotion",
      sorted(MOTION)
        .filter(([k]) => k.endsWith("Ms"))
        .map(([k, v]) => `    const val ${k} = ${v}`),
    ),
    ...obj(
      "BrambleEase",
      sorted(EASE).map(([k, v]) => `    val ${k} = CubicBezierEasing(${bezier(v).join("f, ")}f)`),
    ),
    ...obj(
      "BrambleSpring",
      sorted(SPRING).map(
        ([k, v]) =>
          `    val ${k} = BrambleSpringSpec(response = ${v.response}f, damping = ${v.damping}f)`,
      ),
    ),
    ...obj(
      "BrambleShadow",
      sorted(SHADOW).map(([k, v]) => {
        const { alpha, blur, y } = shadow(v);
        return `    val ${k} = BrambleShadowStyle(y = ${y}.dp, blur = ${blur}.dp, alpha = ${alpha}f)`;
      }),
    ),
    kotlinIconEnum(),
  ]
    .join("\n")
    .trimEnd()}\n`;
