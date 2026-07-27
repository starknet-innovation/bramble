import type { Meta } from "@storybook/html-vite";
import { escapeHtml } from "../../../src/shared/html";
import { darkSkin } from "../../../src/ui/dark-skin";
import { defaultSkin } from "../../../src/ui/default-skin";
import type { Skin } from "../../../src/ui/skin";
import { EASE, MOTION, RADIUS, SHADOW, SPACE, TYPE } from "../../../src/ui/tokens";
import { CATALOG_META, type CatalogArgs, type CatalogStory, catalogFrame } from "./catalog-frame";
import { catalogGroup, catalogSample } from "./catalog-markup";

const meta = {
  ...CATALOG_META,
  title: "Design system/01 Foundations",
} satisfies Meta<CatalogArgs>;

export default meta;

const skinForTheme = (theme: CatalogArgs["theme"]): Skin =>
  theme === "light" ? defaultSkin : darkSkin;

const semanticColorTokens = new Set(["--mc-danger", "--mc-positive"]);

const colorSwatches = (entries: readonly (readonly [string, string])[]): string =>
  entries
    .map(([name, value]) =>
      catalogSample(
        name.replace("--mc-", ""),
        `<div class="catalog-swatch" style="--swatch:${escapeHtml(value)}"></div>
         <div class="catalog-token-copy"><code>${escapeHtml(name)}</code><span>${escapeHtml(value)}</span></div>`,
      ),
    )
    .join("");

const colors = (args: CatalogArgs): HTMLIFrameElement => {
  const skin = skinForTheme(args.theme);
  const entries = Object.entries(skin.tokens);
  const neutrals = colorSwatches(entries.filter(([name]) => !semanticColorTokens.has(name)));
  const semantics = colorSwatches(entries.filter(([name]) => semanticColorTokens.has(name)));
  return catalogFrame(
    "Colors",
    `${skin.name} maps monochrome interaction roles and explicit success/failure semantics to concrete values. Components consume roles only; no production template owns a color literal.`,
    `${catalogGroup(
      "Monochrome foundation",
      "Surfaces, ink, actions, focus, and selection remain achromatic.",
      `<div class="catalog-grid">${neutrals}</div>`,
    )}
     ${catalogGroup(
       "Reserved signals",
       "Green and red appear only when state carries positive or negative meaning.",
       `<div class="catalog-grid">${semantics}</div>`,
     )}`,
    args.theme,
  );
};

export const Colors: CatalogStory = { render: colors };

const TYPE_LABELS: Readonly<Record<string, string>> = {
  body: "Wallet copy stays compact and highly legible.",
  caption: "Supporting state and recovery guidance.",
  display: "A clear section-level display heading.",
  headline: "Create your wallet with confidence.",
  label: "Field and control label",
  mono: "0x031075ef90ad626dc13fb97cdc7e04499",
  title: "Review transaction",
};

export const Typography: CatalogStory = {
  render: (args) => {
    const rows = (["headline", "display", "title", "body", "label", "caption", "mono"] as const)
      .map((name) => {
        const token = TYPE[name];
        return `<div class="catalog-type-row">
          <span class="catalog-type-meta"><strong>${name}</strong><code>${token.size} / ${token.line}</code></span>
          <span class="catalog-type-sample" data-type="${name}">${escapeHtml(TYPE_LABELS[name] ?? name)}</span>
        </div>`;
      })
      .join("");
    return catalogFrame(
      "Typography",
      "The interface stack carries instructions and actions; the mono stack is reserved for addresses, hashes, and measured wallet data.",
      catalogGroup(
        "Type scale",
        "Size, leading, weight, and voice are named once in the shared token module.",
        rows,
      ),
      args.theme,
    );
  },
};

export const SpacingAndRadius: CatalogStory = {
  name: "Spacing and radius",
  render: (args) => {
    const spacing = Object.entries(SPACE)
      .map(
        ([name, value]) =>
          `<div class="catalog-space-row"><code>${escapeHtml(name)}</code><span class="catalog-space-block" style="--measure:${escapeHtml(value)}"></span><span>${escapeHtml(value)}</span></div>`,
      )
      .join("");
    const radii = Object.entries(RADIUS)
      .map(([name, value]) =>
        catalogSample(
          name,
          `<div class="catalog-radius" style="--radius:${escapeHtml(value)}"><code>${escapeHtml(value)}</code></div>`,
        ),
      )
      .join("");
    return catalogFrame(
      "Spacing and radius",
      "A four-pixel rhythm keeps dense wallet tasks aligned; named radii distinguish fields, grouped surfaces, and pills.",
      `${catalogGroup("Spacing", "All layout rhythm resolves to the shared scale.", `<div class="catalog-stack">${spacing}</div>`)}
       ${catalogGroup("Radius", "Shape follows component role rather than local preference.", `<div class="catalog-grid">${radii}</div>`)}`,
      args.theme,
    );
  },
};

export const ElevationAndMotion: CatalogStory = {
  name: "Elevation and motion",
  render: (args) => {
    const shadows = Object.entries(SHADOW)
      .map(([name, value]) =>
        catalogSample(
          name,
          `<div class="catalog-shadow" style="--shadow:${escapeHtml(value)}"></div><code>${escapeHtml(value)}</code>`,
        ),
      )
      .join("");
    const motion = catalogSample(
      "Response sample",
      `<div class="catalog-row"><span class="catalog-motion-mark">↗</span><span>Hover to inspect the shared ease-out response.</span></div>
       <code>${MOTION.enterMs}ms · ${escapeHtml(EASE.out)}</code>`,
    );
    return catalogFrame(
      "Elevation and motion",
      "Low elevation separates genuine floating chrome. Short, decisive motion communicates state change and collapses under reduced-motion.",
      `${catalogGroup("Elevation", "Shadows have a directional offset and remain deliberately restrained.", `<div class="catalog-grid">${shadows}</div>`)}
       ${catalogGroup("Motion", "One shared response language for press, enter, drawer, and toast moments.", motion)}`,
      args.theme,
    );
  },
};
