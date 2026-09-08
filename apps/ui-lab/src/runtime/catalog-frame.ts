import type { Meta, StoryObj } from "@storybook/html-vite";
import { CATALOG_STYLES } from "./catalog-styles";
import type { LabTheme } from "./types";
import { walletFrameDocument } from "./wallet-frame";

export type CatalogArgs = {
  readonly theme: LabTheme;
};

export type CatalogStory = StoryObj<CatalogArgs>;

/**
 * Shared Storybook metadata for production design-system specimens.
 */
export const CATALOG_META: Meta<CatalogArgs> = {
  argTypes: {
    theme: {
      control: "inline-radio",
      options: ["dark", "light"],
    },
  },
  args: { theme: "dark" },
  parameters: {
    chromatic: { pauseAnimationAtEnd: true },
    docs: {
      description: {
        component:
          "Production Bramble components rendered with the extension stylesheet and skin tokens. These specimens contain fixture data only.",
      },
    },
  },
  tags: ["autodocs"],
};

/**
 * Creates one isolated design-system canvas. The frame contains only trusted
 * Storybook fixtures and never loads the vault, hardware, or production RPC.
 */
export const catalogFrame = (
  title: string,
  description: string,
  body: string,
  theme: LabTheme,
): HTMLIFrameElement => {
  const frame = document.createElement("iframe");
  frame.dataset["catalogFrame"] = "true";
  frame.style.border = "0";
  frame.style.display = "block";
  frame.style.height = "100vh";
  frame.style.width = "100%";
  frame.title = `${title} design-system specimens`;
  frame.srcdoc = walletFrameDocument(
    `<article class="catalog-page">
      <header class="catalog-heading">
        <p class="eyebrow">Bramble design system</p>
        <h1>${title}</h1>
        <p>${description}</p>
      </header>
      ${body}
    </article>`,
    "fullpage",
    theme,
    false,
    CATALOG_STYLES,
  );
  return frame;
};
