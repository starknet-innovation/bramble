import { dockNavigation, menuLink, menuRow, optionRow } from "@mc-wallet/ui-kit/navigation";
import { homeTabs } from "@mc-wallet/wallet-ui/sidepanel/home-tabs";
import { flowHeader } from "@mc-wallet/wallet-ui/sidepanel/parts";
import type { Meta } from "@storybook/html-vite";
import { CATALOG_META, type CatalogArgs, type CatalogStory, catalogFrame } from "./catalog-frame";
import { catalogGroup, catalogSample } from "./catalog-markup";
import { discoveredNft, statusFor } from "./fixtures";
import {
  journeyBalances,
  journeyChanges,
  journeyPreferences,
  journeyPrices,
} from "./journey-fixtures";

const meta = {
  ...CATALOG_META,
  title: "Design system/06 Navigation",
} satisfies Meta<CatalogArgs>;

export default meta;

export const FlowHeaders: CatalogStory = {
  name: "Flow headers",
  render: (args) =>
    catalogFrame(
      "Flow headers",
      "Every focused wallet task begins with a back action, a concrete goal, optional context, and the active network.",
      catalogGroup(
        "Task context",
        "Rendered by the production side-panel flow-header helper.",
        catalogSample(
          "Send",
          flowHeader("Send", statusFor(), "Choose a token and recipient"),
          "catalog-card-limit",
        ),
      ),
      args.theme,
    ),
};

export const MenuAndOptionRows: CatalogStory = {
  name: "Menu and option rows",
  render: (args) =>
    catalogFrame(
      "Menu and option rows",
      "Grouped rows map destinations and choices without building a separate card around every action.",
      catalogGroup(
        "Grouped navigation",
        "Menu rows navigate; option rows expose selection state.",
        `<div class="catalog-grid wide">
          ${catalogSample("Menu", `<div class="catalog-menu">${menuRow({ icon: "globe", label: "Network", value: "Starknet Mainnet" })}${menuRow({ icon: "shield", label: "Backup & restore" })}${menuLink({ href: "https://github.com/mc-wallet/mc-wallet#readme", icon: "book", label: "Help & docs", target: "_blank" })}</div>`)}
          ${catalogSample("Options", `<div class="catalog-menu">${optionRow({ icon: "wallet", label: "Daily account", pressed: true, supportingText: "0x1234…abcd", value: "Active" })}${optionRow({ icon: "shield", label: "Ledger vault", supportingText: "Hardware account" })}</div>`)}
        </div>`,
      ),
      args.theme,
    ),
};

export const TabsAndDock: CatalogStory = {
  name: "Tabs and dock",
  render: (args) =>
    catalogFrame(
      "Tabs and dock",
      "Portfolio tabs switch local asset context; the dock preserves the three top-level wallet destinations.",
      `${catalogGroup(
        "Portfolio tabs",
        "All panels render up front so switching is immediate and state-preserving.",
        catalogSample(
          "Tokens selected",
          homeTabs(
            { balances: journeyBalances },
            journeyPreferences,
            journeyPrices,
            journeyChanges,
            "usd",
            statusFor(),
            [discoveredNft],
          ),
        ),
      )}
      ${catalogGroup(
        "Wallet dock",
        "Static placement in this specimen exposes the production dock component without obscuring the catalog canvas.",
        catalogSample(
          "Home selected",
          dockNavigation([
            { controls: "wallet-screen-home", icon: "home", label: "Home", selected: true },
            {
              controls: "wallet-screen-activity",
              count: 2,
              icon: "activity",
              label: "Activity",
              selected: false,
            },
            {
              controls: "wallet-screen-settings",
              icon: "settings",
              label: "Settings",
              selected: false,
            },
          ]),
          "catalog-dock-stage",
        ),
      )}`,
      args.theme,
    ),
};
