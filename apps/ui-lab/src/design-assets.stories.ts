import { ICON_NAMES, icon } from "@mc-wallet/ui-kit/icons";
import { accountAvatar } from "@mc-wallet/wallet-ui/sidepanel/parts";
import { tokenGlyph } from "@mc-wallet/wallet-ui/sidepanel/token-row";
import type { Meta } from "@storybook/html-vite";
import { CATALOG_META, type CatalogArgs, type CatalogStory, catalogFrame } from "./catalog-frame";
import { catalogGroup, catalogSample } from "./catalog-markup";
import { LEDGER_ADDRESS, SECOND_ADDRESS, SOFTWARE_ADDRESS, USDC_ADDRESS } from "./fixtures";

const meta = {
  ...CATALOG_META,
  title: "Design system/07 Assets",
} satisfies Meta<CatalogArgs>;

export default meta;

export const Icons: CatalogStory = {
  render: (args) =>
    catalogFrame(
      "Icons",
      "One shared registry keeps glyph geometry, sizing, and accessibility consistent across every wallet surface.",
      catalogGroup(
        "Registered glyphs",
        "Icons are decorative; the owning control or adjacent copy carries the accessible name.",
        `<div class="catalog-icon-grid">${ICON_NAMES.map(
          (name) => `<span class="catalog-icon">${icon(name)}<code>${name}</code></span>`,
        ).join("")}</div>`,
      ),
      args.theme,
    ),
};

export const IdentityMarks: CatalogStory = {
  name: "Identity marks",
  render: (args) =>
    catalogFrame(
      "Identity marks",
      "Deterministic account avatars and token marks improve scanning without asserting unverified brand identity.",
      catalogGroup(
        "Account and token identity",
        "Account marks are derived locally from the full public address. Known tokens use bundled vector marks; unknown tokens fall back to escaped deterministic initials.",
        `<div class="catalog-grid">
          ${catalogSample(
            "Address identities",
            `<div class="catalog-row">
              <span class="brand-mark" title="Daily account">${accountAvatar(SOFTWARE_ADDRESS)}</span>
              <span class="brand-mark" title="Ledger vault">${accountAvatar(LEDGER_ADDRESS)}</span>
              <span class="brand-mark" title="Trading account">${accountAvatar(SECOND_ADDRESS)}</span>
              <span>Stable, distinct marks</span>
            </div>`,
          )}
          ${catalogSample("Known token", `<div class="catalog-row">${tokenGlyph(USDC_ADDRESS, "USDC")}<span>USD Coin</span></div>`)}
          ${catalogSample("Fallback token", `<div class="catalog-row">${tokenGlyph("0x999", "NEW")}<span>Unverified token</span></div>`)}
        </div>`,
      ),
      args.theme,
    ),
};
