import type { StorybookConfig } from "@storybook/html-vite";

const config: StorybookConfig = {
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  staticDirs: ["../public"],
  stories: ["../src/**/*.stories.ts"],
};

export default config;
