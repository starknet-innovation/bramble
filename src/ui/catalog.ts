/**
 * Authoritative inventory for the MC Wallet design system. Production classes
 * and renderers are documented here once; Storybook coverage is checked
 * against these ids so new primitives cannot ship undocumented.
 */

/**
 * Design-system catalog entry.
 */
export type UiCatalogEntry<Id extends string = string> = {
  readonly description: string;
  readonly group: string;
  readonly id: Id;
  readonly name: string;
};

/**
 * Foundation concepts Storybook must describe.
 */
export const UI_FOUNDATIONS = [
  {
    description: "Achromatic surface/action roles plus explicit success and failure semantics.",
    group: "Foundations",
    id: "colors",
    name: "Colors",
  },
  {
    description: "Interface, display, caption, and wallet-data type hierarchy.",
    group: "Foundations",
    id: "typography",
    name: "Typography",
  },
  {
    description: "The shared four-pixel spacing rhythm and corner-radius scale.",
    group: "Foundations",
    id: "spacing-radius",
    name: "Spacing and radius",
  },
  {
    description: "Low elevation, response durations, easing curves, and springs.",
    group: "Foundations",
    id: "elevation-motion",
    name: "Elevation and motion",
  },
] as const satisfies readonly UiCatalogEntry[];

/**
 * Production UI patterns Storybook must demonstrate.
 */
export const UI_COMPONENTS = [
  {
    description: "Primary, secondary, ghost, danger, small, disabled, and busy actions.",
    group: "Controls",
    id: "buttons",
    name: "Buttons",
  },
  {
    description: "Compact named actions with registered decorative glyphs.",
    group: "Controls",
    id: "icon-buttons",
    name: "Icon buttons",
  },
  {
    description: "Native text, password, textarea, select, and checkbox controls.",
    group: "Controls",
    id: "fields",
    name: "Fields",
  },
  {
    description: "Mutually exclusive compact preference controls.",
    group: "Controls",
    id: "segmented-controls",
    name: "Segmented controls",
  },
  {
    description: "Neutral information, waiting, warning, and recovery notices.",
    group: "Feedback",
    id: "callouts",
    name: "Callouts",
  },
  {
    description: "Quiet empty and degraded states with honest recovery copy.",
    group: "Feedback",
    id: "empty-states",
    name: "Empty states",
  },
  {
    description: "Compact network, hardware, count, and semantic status markers.",
    group: "Feedback",
    id: "pills-badges",
    name: "Pills and badges",
  },
  {
    description: "Transient success, error, and copy feedback.",
    group: "Feedback",
    id: "toasts",
    name: "Toasts",
  },
  {
    description: "Aligned label/value facts for transaction review.",
    group: "Data display",
    id: "receipts",
    name: "Receipts",
  },
  {
    description: "Token identity, amount, fiat value, and change.",
    group: "Data display",
    id: "token-rows",
    name: "Token rows",
  },
  {
    description: "Account-partitioned activity summary and transaction status.",
    group: "Data display",
    id: "activity-rows",
    name: "Activity rows",
  },
  {
    description: "Security-sensitive dapp decision surface.",
    group: "Cards",
    id: "request-cards",
    name: "Request cards",
  },
  {
    description: "Collectible preview, provenance, spam, and transfer context.",
    group: "Cards",
    id: "collectible-cards",
    name: "Collectible cards",
  },
  {
    description: "Risk flags and decoded transaction review details.",
    group: "Cards",
    id: "review-panels",
    name: "Review panels",
  },
  {
    description: "Back navigation, task title, and network context.",
    group: "Navigation",
    id: "flow-headers",
    name: "Flow headers",
  },
  {
    description: "Grouped destination and chooser rows.",
    group: "Navigation",
    id: "menu-option-rows",
    name: "Menu and option rows",
  },
  {
    description: "Portfolio tabs and the persistent three-destination wallet dock.",
    group: "Navigation",
    id: "tabs-dock",
    name: "Tabs and dock",
  },
  {
    description: "The complete registered wallet glyph set.",
    group: "Assets",
    id: "icons",
    name: "Icons",
  },
  {
    description: "Deterministic account avatars and token identity marks.",
    group: "Assets",
    id: "identity-marks",
    name: "Identity marks",
  },
] as const satisfies readonly UiCatalogEntry[];

/**
 * Foundation id covered by Storybook.
 */
export type UiFoundationId = (typeof UI_FOUNDATIONS)[number]["id"];

/**
 * Component id covered by Storybook.
 */
export type UiComponentId = (typeof UI_COMPONENTS)[number]["id"];
