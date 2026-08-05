import type { Preview } from "@storybook/html-vite";
import { darkSkin } from "../../../src/ui/dark-skin";

const preview: Preview = {
  parameters: {
    a11y: {
      test: "error",
    },
    backgrounds: {
      default: "review bench",
      options: {
        "review bench": {
          name: "Review bench",
          value: darkSkin.tokens["--mc-bg"],
        },
      },
    },
    controls: {
      disableSaveFromUI: true,
    },
    layout: "fullscreen",
    options: {
      storySort: {
        order: [
          "Design system",
          [
            "01 Foundations",
            "02 Controls",
            "03 Feedback",
            "04 Data display",
            "05 Cards",
            "06 Navigation",
            "07 Assets",
          ],
          "Wallet journeys",
          [
            "01 Onboarding",
            "02 Portfolio",
            "03 Send and swap",
            "04 Private balances",
            "05 Ledger",
            "06 dApp requests",
            "07 Activity and assets",
            "08 Collectibles",
            "09 Multisig",
            "10 Settings and security",
          ],
          "Wallet UI Lab",
        ],
      },
    },
    viewport: {
      options: {
        "mc-sidepanel": {
          name: "MC side panel · 400 × 760",
          styles: { height: "760px", width: "400px" },
          type: "desktop",
        },
        "mc-popup": {
          name: "MC popup · 380 × 600",
          styles: { height: "600px", width: "380px" },
          type: "desktop",
        },
      },
    },
  },
};

export default preview;
