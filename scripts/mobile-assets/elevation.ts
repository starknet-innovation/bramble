/**
 * Which elevation tier and press scale each mobile component uses, read from the side panel's
 * rendered stylesheet. The tables below name only a Swift identifier and the CSS selector it
 * mirrors; the tier and the scale always come from the CSS, so re-tuning a shadow in the extension
 * reaches the apps on the next `bun run mobile:assets`.
 *
 * Generation fails when a listed selector has no rule, when a shadow is not one of the `SHADOW`
 * tiers, when the stylesheet overrides a listed shadow at phone width without a phone variant
 * here, and when the stylesheet grows an elevation (a non-inset, blurred shadow) that is neither
 * listed nor explicitly ignored — so a new shadow cannot drift silently.
 */
import { SHADOW } from "@bramble/ui-kit/tokens";
import { type CssRule, declaredValue, resolveVars, rootProperties } from "./css";

/** The phone-width breakpoint every iPhone falls under (design-mobile.md 4.7). */
export const PHONE_MEDIA = "(max-width: 520px)";
/** The short-height breakpoint an iPhone SE falls under (design-mobile.md 4.7). */
export const SHORT_MEDIA = "(max-height: 760px)";

/** Swift identifier → the side panel selector whose `box-shadow` it mirrors. */
export const ELEVATION_COMPONENTS = {
  accountDrawer: ".account-drawer",
  approvalLive: ".approval-live",
  dock: ".wallet-dock",
  nftArtPressed: "button.nft-open:not(:disabled):active .nft-art",
  onboardingAccountSelected: '.onboarding-account[aria-pressed="true"]',
  onboardingComplete: ".onboarding-complete",
  onboardingContractSelected: '.onboarding-contract[aria-pressed="true"]',
  onboardingWizard: ".onboarding-wizard",
  portfolioMenu: ".portfolio-menu",
  qrCard: ".qr-card",
  recoverySuggestions: ".recovery-suggestions",
  requestCard: ".request-card",
  segmentSelected: 'button.seg-option[aria-pressed="true"]',
  sendTaskList: ".send-task-list",
  toast: ".toast",
} as const;

/** Elevation selectors deliberately not mirrored, each with the reason. */
const ELEVATION_IGNORED: Readonly<Record<string, string>> = {
  ".approval-takeover .request-card": "context override to none; mobile has no dApp takeover",
  "button, a.icon-button": "controls are flat (`box-shadow: none`); nothing to mirror",
  ".drawer-network-menu":
    "not ported yet: mobile switches network from Settings, and its drawer has no network menu",
  ".token-dropdown-panel":
    "mobile picks a token on its own screen, the platform idiom, not in a floating panel",
};

/** Swift identifier → the `:active` selector whose `transform: scale()` it mirrors. */
const PRESS_COMPONENTS = {
  actionTile: ".action-tile:not(:disabled):active",
  control: ":where(button:not(:disabled):active)",
  drawerRow: "button.drawer-account:not(:disabled):active",
  homeTab: "button.home-tab:not(:disabled):active",
  iconButton: "button.icon-button:not(:disabled):active",
  navItem: "button.nav-item:not(:disabled):active",
  segment: "button.seg-option:not(:disabled):active",
  tokenRow: "li.token-row:has(button.token-open:active)",
} as const;

const tierOf = (literal: string, where: string): keyof typeof SHADOW | "none" => {
  if (literal === "none") return "none";
  const tier = (Object.keys(SHADOW) as (keyof typeof SHADOW)[]).find(
    (key) => SHADOW[key] === literal,
  );
  if (!tier) {
    throw new Error(`${where}: box-shadow ${literal} is not a SHADOW tier`);
  }
  return tier;
};

/** A ring (`0 0 0 Npx`) or an inset line is a hairline or focus ring, not elevation. */
const isElevation = (literal: string): boolean =>
  literal !== "none" && !literal.startsWith("inset") && !/^0 0 0 /.test(literal);

/** One component's tiers: the base rule, and a phone-width override when the CSS has one. */
export type ElevationEntry = {
  readonly name: string;
  readonly base: keyof typeof SHADOW | "none";
  readonly phone?: keyof typeof SHADOW | "none";
};

/** Reads every listed component's tier and checks the stylesheet has no unlisted elevation. */
export const readElevation = (rules: readonly CssRule[]): readonly ElevationEntry[] => {
  const root = rootProperties(rules);
  const listed = new Set<string>(Object.values(ELEVATION_COMPONENTS));
  for (const rule of rules) {
    for (const [name, value] of rule.declarations) {
      if (name !== "box-shadow" || !isElevation(value)) continue;
      const literal = resolveVars(value, root);
      if (!isElevation(literal)) continue;
      for (const selector of rule.selectors) {
        if (!listed.has(selector) && !(selector in ELEVATION_IGNORED)) {
          throw new Error(`Unlisted elevation ${selector} (${literal}); add it to a table`);
        }
      }
    }
  }
  return Object.entries(ELEVATION_COMPONENTS).map(([name, selector]) => {
    const base = declaredValue(rules, selector, "box-shadow");
    if (base === undefined) {
      throw new Error(`${selector} has no box-shadow rule`);
    }
    const phone = declaredValue(rules, selector, "box-shadow", [PHONE_MEDIA]);
    const entry: ElevationEntry = { base: tierOf(resolveVars(base, root), selector), name };
    return phone === undefined
      ? entry
      : { ...entry, phone: tierOf(resolveVars(phone, root), `${selector} ${PHONE_MEDIA}`) };
  });
};

/** Reads every listed component's press scale. */
export const readPressScales = (
  rules: readonly CssRule[],
): readonly { readonly name: string; readonly scale: number }[] =>
  Object.entries(PRESS_COMPONENTS).map(([name, selector]) => {
    const transform = declaredValue(rules, selector, "transform");
    const scale = /^scale\((\d+(?:\.\d+)?)\)$/.exec(transform ?? "")?.[1];
    if (!scale) {
      throw new Error(`${selector} has no transform: scale() rule`);
    }
    return { name, scale: Number(scale) };
  });

const swiftTier = (tier: keyof typeof SHADOW | "none"): string =>
  tier === "none" ? "nil" : `BrambleShadow.${tier}`;

/** The px value of a `(max-…: Npx)` condition that the stylesheet actually uses. */
const breakpoint = (rules: readonly CssRule[], media: string): number => {
  const value = /^\(max-(?:width|height): (\d+)px\)$/.exec(media)?.[1];
  if (!value || !rules.some((rule) => rule.media.includes(media))) {
    throw new Error(`The stylesheet has no ${media} rules`);
  }
  return Number(value);
};

/** The Swift `BrambleBreakpoint`, `BrambleElevation` and `BramblePress` enums. */
export const renderSwiftElevation = (rules: readonly CssRule[]): string[] => [
  "/// The side panel's layout breakpoints (inclusive `max-` conditions), evaluated on the full",
  "/// scene size, as a CSS viewport is (design-mobile.md 4.7).",
  "enum BrambleBreakpoint {",
  `    static let phoneWidth: CGFloat = ${breakpoint(rules, PHONE_MEDIA)}`,
  `    static let shortHeight: CGFloat = ${breakpoint(rules, SHORT_MEDIA)}`,
  "}",
  "",
  "/// Which `BrambleShadow` tier each component casts, read from the side panel's `box-shadow`",
  "/// rules (`SIDEPANEL_STYLES`). nil is `box-shadow: none`; `…Phone` is the `max-width: 520px`",
  "/// override every iPhone falls under.",
  "enum BrambleElevation {",
  ...readElevation(rules).flatMap((entry) => [
    `    static let ${entry.name}: BrambleShadowStyle? = ${swiftTier(entry.base)}`,
    ...(entry.phone === undefined
      ? []
      : [`    static let ${entry.name}Phone: BrambleShadowStyle? = ${swiftTier(entry.phone)}`]),
  ]),
  "}",
  "",
  "/// Press scales from the side panel's `:active` rules.",
  "enum BramblePress {",
  ...readPressScales(rules).map(({ name, scale }) => `    static let ${name}: CGFloat = ${scale}`),
  "}",
  "",
];
