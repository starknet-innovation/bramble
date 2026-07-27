import type { Preview } from "@storybook/html-vite";

const preview: Preview = {
  parameters: {
    a11y: {
      test: "error",
    },
    backgrounds: {
      default: "review bench",
      options: {
        "review bench": { name: "Review bench", value: "#090c12" },
      },
    },
    controls: {
      disableSaveFromUI: true,
    },
    layout: "fullscreen",
    options: {
      storySort: {
        order: ["Wallet UI Lab"],
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
