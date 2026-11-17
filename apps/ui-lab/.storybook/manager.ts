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
    color: ${tokens["--bramble-muted"]} !important;
  }

  input[type="checkbox"],
  input[type="radio"] {
    accent-color: ${tokens["--bramble-accent"]};
  }
`;
document.head.append(managerChromeStyles);

addons.setConfig({
  theme: create({
    base: "dark",
    brandTitle: "Bramble UI Lab",
    colorPrimary: tokens["--bramble-accent"],
    colorSecondary: tokens["--bramble-muted"],
    appBg: tokens["--bramble-bg"],
    appContentBg: tokens["--bramble-panel"],
    appHoverBg: tokens["--bramble-elevated"],
    appPreviewBg: tokens["--bramble-bg"],
    appBorderColor: tokens["--bramble-border"],
    appBorderRadius: 8,
    fontBase: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
    fontCode: "ui-monospace, SFMono-Regular, Menlo, monospace",
    textColor: tokens["--bramble-text"],
    textInverseColor: tokens["--bramble-accent-text"],
    textMutedColor: tokens["--bramble-muted"],
    barTextColor: tokens["--bramble-muted"],
    barHoverColor: tokens["--bramble-text"],
    barSelectedColor: tokens["--bramble-accent"],
    barBg: tokens["--bramble-panel"],
    buttonBg: tokens["--bramble-elevated"],
    buttonBorder: tokens["--bramble-border"],
    booleanBg: tokens["--bramble-elevated"],
    booleanSelectedBg: tokens["--bramble-accent"],
    inputBg: tokens["--bramble-elevated"],
    inputBorder: tokens["--bramble-border"],
    inputTextColor: tokens["--bramble-text"],
    inputBorderRadius: 8,
  }),
});
