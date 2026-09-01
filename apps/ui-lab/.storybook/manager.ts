import { darkSkin } from "@bramble/ui-kit/dark-skin";
import { addons } from "storybook/manager-api";
import { create } from "storybook/theming/create";

const tokens = darkSkin.tokens;

// Storybook's status glyphs and native controls bypass the configured theme.
// Keep review-tool chrome neutral so it cannot be mistaken for wallet semantics.
const managerChromeStyles = document.createElement("style");
managerChromeStyles.textContent = `
  button[data-testid="context-menu"],
  button[data-testid="tree-change-status-button"] {
    color: ${tokens["--mc-muted"]} !important;
  }

  input[type="checkbox"],
  input[type="radio"] {
    accent-color: ${tokens["--mc-accent"]};
  }
`;
document.head.append(managerChromeStyles);

addons.setConfig({
  theme: create({
    base: "dark",
    brandTitle: "MC Wallet UI Lab",
    colorPrimary: tokens["--mc-accent"],
    colorSecondary: tokens["--mc-muted"],
    appBg: tokens["--mc-bg"],
    appContentBg: tokens["--mc-panel"],
    appHoverBg: tokens["--mc-elevated"],
    appPreviewBg: tokens["--mc-bg"],
    appBorderColor: tokens["--mc-border"],
    appBorderRadius: 8,
    fontBase: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    fontCode: "ui-monospace, SFMono-Regular, Menlo, monospace",
    textColor: tokens["--mc-text"],
    textInverseColor: tokens["--mc-accent-text"],
    textMutedColor: tokens["--mc-muted"],
    barTextColor: tokens["--mc-muted"],
    barHoverColor: tokens["--mc-text"],
    barSelectedColor: tokens["--mc-accent"],
    barBg: tokens["--mc-panel"],
    buttonBg: tokens["--mc-elevated"],
    buttonBorder: tokens["--mc-border"],
    booleanBg: tokens["--mc-elevated"],
    booleanSelectedBg: tokens["--mc-accent"],
    inputBg: tokens["--mc-elevated"],
    inputBorder: tokens["--mc-border"],
    inputTextColor: tokens["--mc-text"],
    inputBorderRadius: 8,
  }),
});
