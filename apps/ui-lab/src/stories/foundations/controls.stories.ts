import { button, iconButton, iconLink, segmentedControl } from "@bramble/ui-kit/controls";
import {
  checkboxField,
  inputControl,
  selectField,
  textareaField,
  textField,
} from "@bramble/ui-kit/fields";
import type { Meta } from "@storybook/html-vite";
import {
  CATALOG_META,
  type CatalogArgs,
  type CatalogStory,
  catalogFrame,
} from "../../runtime/catalog-frame";
import { catalogGroup, catalogSample } from "../../runtime/catalog-markup";

const meta = {
  ...CATALOG_META,
  title: "Design system/02 Controls",
} satisfies Meta<CatalogArgs>;

export default meta;

export const Buttons: CatalogStory = {
  render: (args) =>
    catalogFrame(
      "Buttons",
      "Button hierarchy is semantic and shared. Primary actions advance the task; secondary and ghost actions preserve focus; danger is always explicit.",
      catalogGroup(
        "Hierarchy and states",
        "Every specimen is rendered by packages/presentation/ui-kit/src/components/controls.ts.",
        `<div class="catalog-grid wide">
          ${catalogSample("Primary", `<div class="catalog-row">${button({ icon: "send", label: "Review send" })}${button({ disabled: true, label: "Unavailable" })}</div>`)}
          ${catalogSample("Secondary", `<div class="catalog-row">${button({ icon: "refresh", label: "Try again", variant: "secondary" })}${button({ label: "Small action", size: "small", variant: "secondary" })}</div>`)}
          ${catalogSample("Ghost and danger", `<div class="catalog-row">${button({ label: "Cancel", variant: "ghost" })}${button({ label: "Remove", tone: "danger", variant: "secondary" })}</div>`)}
          ${catalogSample("Busy", `<div class="catalog-row">${button({ attributes: { "aria-busy": "true", "data-busy": true }, icon: "refresh", label: "Submitting request…" })}</div>`)}
        </div>`,
      ),
      args.theme,
    ),
};

export const IconButtons: CatalogStory = {
  name: "Icon buttons",
  render: (args) =>
    catalogFrame(
      "Icon buttons",
      "Icon-only controls keep dense wallet chrome efficient without sacrificing explicit accessible names.",
      catalogGroup(
        "Variants",
        "The glyph is decorative; aria-label and title are always emitted together.",
        `<div class="catalog-row">
          ${iconButton({ icon: "copy", label: "Copy address" })}
          ${iconButton({ icon: "refresh", label: "Refresh balances", variant: "ghost" })}
          ${iconButton({ icon: "x", label: "Remove account", tone: "danger" })}
          ${iconButton({ disabled: true, icon: "send", label: "Send unavailable" })}
          ${iconLink({
            href: "https://mc-wallet-terminal.vercel.app",
            icon: "terminal",
            label: "Open terminal",
            target: "_blank",
            variant: "ghost",
          })}
        </div>`,
      ),
      args.theme,
    ),
};

export const Fields: CatalogStory = {
  render: (args) =>
    catalogFrame(
      "Fields",
      "Native controls retain browser semantics and autocomplete. Shared renderers escape every label, hint, value, and option.",
      catalogGroup(
        "Form controls",
        "Normal, supporting, disabled, and security-sensitive field states.",
        `<div class="catalog-grid wide">
          ${catalogSample("Text", textField({ hint: "A friendly label shown only in this wallet.", label: "Account name", name: "accountName", placeholder: "Daily account" }))}
          ${catalogSample("Password", textField({ autocomplete: "current-password", label: "Vault passphrase", minlength: 12, name: "vaultUnlock", placeholder: "Enter your passphrase", type: "password" }))}
          ${catalogSample("Textarea", textareaField({ hint: "Store recovery words offline.", label: "Recovery phrase", name: "recoveryWords", placeholder: "12 or 24 words", spellcheck: false }))}
          ${catalogSample(
            "Select",
            selectField({
              label: "Network",
              name: "network",
              options: [
                { label: "Starknet Mainnet", value: "SN_MAIN" },
                { label: "Starknet Sepolia", value: "SN_SEPOLIA" },
              ],
              selected: "SN_MAIN",
            }),
          )}
          ${catalogSample("Checkbox", checkboxField({ checked: true, name: "mainnetAck", text: "I understand this action uses real funds." }))}
          ${catalogSample("Inline search", inputControl({ ariaLabel: "Search tokens", autocomplete: "off", className: "swap-search", placeholder: "Token name or address", type: "search" }))}
          ${catalogSample("Disabled", textField({ disabled: true, label: "RPC endpoint", name: "rpc", value: "Managed by this network" }))}
        </div>`,
      ),
      args.theme,
    ),
};

export const SegmentedControls: CatalogStory = {
  name: "Segmented controls",
  render: (args) =>
    catalogFrame(
      "Segmented controls",
      "A compact choice between a small, mutually exclusive set of preference states.",
      catalogGroup(
        "Preference selection",
        "Pressed state is explicit and keyboard-visible.",
        `<div class="catalog-card-limit">${segmentedControl("Theme", [
          { label: "Dark", pressed: true },
          { label: "Light", pressed: false },
        ])}</div>`,
      ),
      args.theme,
    ),
};
