import type { UiComponentId, UiFoundationId } from "../../../src/ui/catalog";

/**
 * Storybook coverage registry for design foundations.
 */
export const FOUNDATION_STORY_COVERAGE = [
  "colors",
  "typography",
  "spacing-radius",
  "elevation-motion",
] as const satisfies readonly UiFoundationId[];

/**
 * Storybook coverage registry for production components.
 */
export const COMPONENT_STORY_COVERAGE = [
  "buttons",
  "icon-buttons",
  "fields",
  "segmented-controls",
  "callouts",
  "empty-states",
  "pills-badges",
  "toasts",
  "receipts",
  "token-rows",
  "activity-rows",
  "request-cards",
  "collectible-cards",
  "review-panels",
  "flow-headers",
  "menu-option-rows",
  "tabs-dock",
  "icons",
  "identity-marks",
] as const satisfies readonly UiComponentId[];
