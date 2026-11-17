import type { StorybookConfig } from "@storybook/html-vite";

const config: StorybookConfig = {
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  // The onboarding backdrop is served from the extension's own public assets so
  // the lab renders exactly the file the build ships, without a second copy.
  staticDirs: ["../public", { from: "../../extension/public/brand", to: "/brand" }],
  stories: ["../src/**/*.stories.ts"],
};

export default config;
