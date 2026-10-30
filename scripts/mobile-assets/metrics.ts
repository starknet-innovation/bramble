/**
 * Layout metrics the iOS components read from the side panel's rendered stylesheet: paddings,
 * gaps, radii, minimum heights, type sizes, weights and tracking, per component. The table names a
 * selector and a property only; every number comes from `SIDEPANEL_STYLES`, so the phone layout
 * follows the extension when a rule is re-tuned. A missing rule or a value shape the reader cannot
 * express throws, rather than emitting a guess.
 */
import { type CssRule, declaredValue, evaluatePx, resolveVars, rootProperties } from "./css";
import { PHONE_MEDIA, SHORT_MEDIA } from "./elevation";
import { SEND_LAYOUT_METRICS } from "./send-metrics";

/**
 * How a declared value is read:
 * `px` a length or calc(); `min`/`minPercent` the px arm / percent arm (as a fraction) of
 * `min(Apx, B%)`; `clampMin` the floor of a
 * `clamp()`; `top`/`bottom`/`leading`/`trailing` one edge of a padding/margin shorthand; `insets`
 * all four edges; `em` a letter-spacing; `weight` a font-weight; `number` a unitless number;
 * `ms` the duration of an `animation` shorthand.
 */
type Kind =
  | "px"
  | "min"
  | "minPercent"
  | "clampMin"
  | "top"
  | "bottom"
  | "leading"
  | "trailing"
  | "insets"
  | "em"
  | "weight"
  | "number"
  | "ms";

/** Where one metric lives: a selector, a property, how to read it, and an optional media query. */
export type Metric = readonly [selector: string, property: string, kind: Kind, media?: string];

const B = "button";
const ONB = ".onboarding-step";

/** Swift enum → metric name → where the value lives in the stylesheet. */
const LAYOUT_METRICS: Readonly<Record<string, Readonly<Record<string, Metric>>>> = {
  ActionRow: { gap: [".action-row", "gap", "px"] },
  ActionTile: {
    gap: [".action-tile", "gap", "px"],
    height: [".action-tile", "min-height", "px"],
    padding: [".action-tile", "padding", "insets"],
    radius: [".action-tile", "border-radius", "px"],
  },
  Badge: {
    fontSize: [".badge", "font-size", "px"],
    minWidth: [".badge", "min-width", "px"],
    padding: [".badge", "padding", "insets"],
    weight: [".badge", "font-weight", "weight"],
  },
  Button: {
    gap: [B, "gap", "px"],
    height: [B, "min-height", "px"],
    padding: [B, "padding", "insets"],
    tracking: [B, "letter-spacing", "em"],
    weight: [B, "font-weight", "weight"],
  },
  ButtonSmall: {
    fontSize: ["button.small", "font-size", "px"],
    height: ["button.small", "min-height", "px"],
    padding: ["button.small", "padding", "insets"],
  },
  Callout: {
    bodySize: [".callout-copy p", "font-size", "px"],
    copyGap: [".callout-copy", "gap", "px"],
    gap: [".callout", "gap", "px"],
    iconRadius: [".callout-icon", "border-radius", "px"],
    iconSize: [".callout-icon", "height", "px"],
    padding: [".callout", "padding", "insets"],
    radius: [".callout", "border-radius", "px"],
    titleSize: [".callout-copy strong", "font-size", "px"],
  },
  Checkbox: { size: ['input[type="checkbox"]', "height", "px"] },
  Complete: {
    actionsWidth: [".onboarding-complete-actions", "max-width", "px"],
    padding: [".onboarding-complete", "padding", "clampMin"],
  },
  Dock: {
    gap: [".wallet-dock", "gap", "px"],
    height: [":root", "--bramble-dock-h", "px"],
    item: ["button.nav-item", "height", "px"],
    offset: [".wallet-dock", "bottom", "px"],
    padding: [".wallet-dock", "padding", "insets"],
  },
  Dot: {
    degradedPulseMs: [".account-net.degraded .dot", "animation", "ms"],
    degradedPulseOpacity: ["50%", "opacity", "number", "@keyframes network-status-pulse"],
    size: [".dot", "height", "px"],
  },
  Drawer: {
    gap: [".account-drawer", "gap", "px"],
    padding: [".account-drawer", "padding", "insets"],
    rowGap: ["button.drawer-account", "gap", "px"],
    rowHeight: ["button.drawer-account", "min-height", "px"],
    rowPadding: ["button.drawer-account", "padding", "insets"],
    rowRadius: ["button.drawer-account", "border-radius", "px"],
  },
  ErrorPanel: {
    buttonGap: [".panel-error button", "gap", "px"],
    gap: [".panel-error", "gap", "px"],
  },
  Empty: {
    fontSize: [".empty", "font-size", "px"],
    lineHeight: [".empty", "line-height", "number"],
    padding: [".empty", "padding", "insets"],
  },
  Eyebrow: {
    fontSize: [".eyebrow", "font-size", "px"],
    tracking: [".eyebrow", "letter-spacing", "em"],
    weight: [".eyebrow", "font-weight", "weight"],
  },
  Field: {
    height: ["input", "min-height", "px"],
    padding: ["input", "padding", "insets"],
    radius: ["input", "border-radius", "px"],
  },
  FlowHeader: {
    gap: [".flow-header", "gap", "px"],
    padding: [".flow-header", "padding", "insets"],
    subtitleSize: [".flow-title p", "font-size", "px"],
    titleGap: [".flow-title", "gap", "px"],
    titleSize: [".flow-title h1", "font-size", "px"],
  },
  Gate: {
    brandGlyph: [".gate-brand .brand-glyph", "height", "px"],
    brandSize: [".gate-brand", "height", "px"],
    brandTop: [".gate-brand", "margin-top", "px"],
    ctaGap: [".gate-cta", "gap", "px"],
    ctaTop: [".gate-cta", "padding-top", "px"],
    formGap: [".gate-form", "gap", "px"],
    gap: [".gate", "gap", "px"],
    headGap: [".gate-head", "gap", "px"],
    paddingTop: [".gate", "padding-top", "px"],
    titleLineHeight: [".gate-head h1", "line-height", "number"],
    titleSize: [".gate-head h1", "font-size", "px"],
    titleTracking: [".gate-head h1", "letter-spacing", "em"],
    titleWeight: [".gate-head h1", "font-weight", "weight"],
  },
  H1: {
    size: ["h1", "font-size", "px"],
    tracking: ["h1", "letter-spacing", "em"],
    weight: ["h1", "font-weight", "weight"],
  },
  H2: {
    size: ["h2", "font-size", "px"],
    tracking: ["h2", "letter-spacing", "em"],
    weight: ["h2", "font-weight", "weight"],
  },
  HeaderActions: { gap: [".header-actions", "gap", "px"] },
  Hero: {
    gap: [".hero", "gap", "px"],
    padding: [".hero", "padding", "insets"],
    totalLineHeight: [".hero-total", "line-height", "number"],
    totalSize: [".hero-total", "font-size", "px"],
    totalTracking: [".hero-total", "letter-spacing", "em"],
    totalWeight: [".hero-total", "font-weight", "weight"],
  },
  HomeTab: {
    fontSize: ["button.home-tab", "font-size", "px"],
    height: ["button.home-tab", "min-height", "px"],
    weight: ["button.home-tab", "font-weight", "weight"],
  },
  IconButton: {
    busySpinMs: ["#detect-tokens[data-busy] .icon", "animation", "ms"],
    size: ["button.icon-button", "height", "px"],
  },
  InlineAction: {
    fontSize: [".onboarding-inline-action", "font-size", "px"],
    height: [".onboarding-inline-action", "min-height", "px"],
    padding: [".onboarding-inline-action", "padding", "insets"],
  },
  MenuList: {
    hairlineInset: [".menu-list > * + *::before", "left", "px"],
    radius: [".menu-list", "border-radius", "px"],
  },
  MenuRow: {
    gap: ["button.menu-row", "gap", "px"],
    glyph: [".menu-icon .icon", "height", "px"],
    height: ["button.menu-row", "min-height", "px"],
    padding: ["button.menu-row", "padding", "insets"],
    radius: ["button.menu-row", "border-radius", "px"],
    titleSize: [".menu-copy strong", "font-size", "px"],
    titleWeight: [".menu-copy strong", "font-weight", "weight"],
    valueSize: [".menu-value", "font-size", "px"],
  },
  Meter: {
    barHeight: [".password-requirement-bar", "height", "px"],
    fontSize: [".password-requirement", "font-size", "px"],
    gap: [".password-requirement", "gap", "px"],
  },
  Onboarding: {
    backInset: [".onboarding-back", "left", "px"],
    ctaGap: [".onboarding-step-cta", "gap", "px"],
    ctaTop: [".onboarding-step-cta", "padding-top", "px"],
    fieldsGap: [".onboarding-fields", "gap", "px"],
    gap: [ONB, "gap", "px"],
    headBottom: [".onboarding-step-head", "margin", "bottom"],
    headBottomShort: [".onboarding-step-head", "margin-bottom", "px", SHORT_MEDIA],
    headGap: [".onboarding-step-head", "gap", "px"],
    headMaxWidth: [".onboarding-step-head", "max-width", "px"],
    headTop: [".onboarding-step-head", "margin", "top"],
    headTopShort: [".onboarding-step-head", "margin-top", "px", SHORT_MEDIA],
    iconGlyph: [".onboarding-step-icon .icon", "height", "px"],
    iconGap: [".onboarding-step-icon", "margin-bottom", "px"],
    iconSize: [".onboarding-step-icon", "height", "px"],
    ledeLineHeight: [".onboarding-step-head .lede", "line-height", "number"],
    paddingBottom: [ONB, "padding", "bottom"],
    paddingBottomShort: [ONB, "padding-bottom", "px", SHORT_MEDIA],
    paddingInlinePhone: [ONB, "padding-left", "px", PHONE_MEDIA],
    paddingTop: [ONB, "padding", "top"],
    paddingTopShort: [ONB, "padding-top", "px", SHORT_MEDIA],
    titleLineHeight: [".onboarding-step-head h1", "line-height", "number"],
    titleSize: [".onboarding-step-head h1", "font-size", "px"],
    titleTracking: [".onboarding-step-head h1", "letter-spacing", "em"],
    titleWeight: [".onboarding-step-head h1", "font-weight", "weight"],
  },
  OnboardingAccount: {
    checkGlyph: [".onboarding-account-check .icon", "height", "px"],
    height: [".onboarding-account", "min-height", "px"],
  },
  OnboardingOption: {
    chevron: [".onboarding-option > .icon", "height", "px"],
    copyGap: [".onboarding-option-copy", "gap", "px"],
    detailLineHeight: [".onboarding-option-copy span", "line-height", "number"],
    detailSize: [".onboarding-option-copy span", "font-size", "px"],
    gap: [".onboarding-option", "gap", "px"],
    height: [".onboarding-option", "min-height", "px"],
    iconGlyph: [".onboarding-option-icon .icon", "height", "px"],
    iconSize: [".onboarding-option-icon", "height", "px"],
    padding: [".onboarding-option", "padding", "insets"],
    radius: [".onboarding-option", "border-radius", "px"],
    titleSize: [".onboarding-option-copy strong", "font-size", "px"],
    titleWeight: [".onboarding-option-copy strong", "font-weight", "weight"],
  },
  HardwarePill: {
    glyph: [".pill-hardware .icon", "height", "px"],
    height: [".pill-hardware", "min-height", "px"],
    padding: [".pill-hardware", "padding", "insets"],
  },
  Pill: {
    fontSize: [".pill", "font-size", "px"],
    gap: [".pill", "gap", "px"],
    height: [".pill", "min-height", "px"],
    padding: [".pill", "padding", "insets"],
    weight: [".pill", "font-weight", "weight"],
  },
  QRCard: {
    padding: [".qr-card", "padding", "px"],
    radius: [".qr-card", "border-radius", "px"],
    receiveWidth: [".receive-address-view .qr-card", "width", "min"],
  },
  Receive: {
    gap: [".receive-address-view", "gap", "px"],
    introGap: [".receive-intro", "gap", "px"],
    introLineHeight: [".receive-intro p", "line-height", "number"],
    introSize: [".receive-intro p", "font-size", "px"],
    titleSize: [".receive-intro h2", "font-size", "px"],
  },
  Recovery: {
    cellGap: [".recovery-word-cell", "gap", "px"],
    gridGap: [".recovery-grid", "gap", "px"],
    numberSize: [".recovery-word-cell > span:first-child", "font-size", "px"],
    suggestionHeight: [".recovery-suggestion", "min-height", "px"],
    suggestionPadding: [".recovery-suggestion", "padding", "insets"],
    suggestionRadius: [".recovery-suggestion", "border-radius", "px"],
    suggestionsGap: [".recovery-suggestions", "gap", "px"],
    suggestionsPadding: [".recovery-suggestions", "padding", "px"],
    suggestionsRadius: [".recovery-suggestions", "border-radius", "px"],
    wordPadding: [".recovery-word", "padding", "insets"],
    wordSize: [".recovery-word", "font-size", "px"],
  },
  Section: { gap: [".section", "gap", "px"] },
  Screen: {
    gap: [".screen", "gap", "px"],
    shellGap: [".shell", "gap", "px"],
    shellPadding: [".shell", "padding", "insets"],
  },
  Segmented: {
    gap: [".seg", "gap", "px"],
    optionHeight: ["button.seg-option", "min-height", "px"],
    optionPadding: ["button.seg-option", "padding", "insets"],
    optionSize: ["button.seg-option", "font-size", "px"],
    optionWeight: ["button.seg-option", "font-weight", "weight"],
    padding: [".seg", "padding", "px"],
  },
  Toast: {
    copySize: ["button.toast-copy", "height", "px"],
    fontSize: [".toast", "font-size", "px"],
    gap: [".toast", "gap", "px"],
    glyph: [".toast-icon .icon", "height", "px"],
    iconRadius: [".toast-icon", "border-radius", "px"],
    iconSize: [".toast-icon", "height", "px"],
    padding: [".toast", "padding", "insets"],
    radius: [".toast", "border-radius", "px"],
    stackBottom: [".toast-stack", "bottom", "px"],
    stackGap: [".toast-stack", "gap", "px"],
    stackInset: [".toast-stack", "left", "px"],
    weight: [".toast", "font-weight", "weight"],
  },
  TokenRow: {
    amountSize: [".token-copy p", "font-size", "px"],
    copyGap: [".token-copy", "gap", "px"],
    fiatSize: [".token-fiat", "font-size", "px"],
    gap: [".token-row", "gap", "px"],
    markSize: [".token-mark", "height", "px"],
    markTextSize: [".token-mark", "font-size", "px"],
    markTracking: [".token-mark", "letter-spacing", "em"],
    markWeight: [".token-mark", "font-weight", "weight"],
    padding: [".token-row", "padding", "insets"],
    radius: [".token-row", "border-radius", "px"],
    symbolSize: [".token-copy strong", "font-size", "px"],
    symbolWeight: [".token-copy strong", "font-weight", "weight"],
    valueWeight: [".token-amount", "font-weight", "weight"],
  },
  WalletHeader: {
    accountGap: [".account-meta", "gap", "px"],
    chevron: [".account-name .icon", "height", "px"],
    gap: [".wallet-header", "gap", "px"],
    nameGap: [".account-name", "gap", "px"],
    nameSize: [".account-name strong", "font-size", "px"],
    nameWeight: [".account-name strong", "font-weight", "weight"],
    netDot: [".account-net .dot", "height", "px"],
    netGap: [".account-net", "gap", "px"],
    netSize: [".account-net", "font-size", "px"],
    padding: [".wallet-header", "padding", "insets"],
    triggerGap: ["button.account-trigger", "gap", "px"],
    triggerPadding: ["button.account-trigger", "padding", "insets"],
  },
  Welcome: {
    actionsGap: [".onboarding-welcome-actions", "gap", "px"],
    lockupHeight: [".onboarding-lockup", "min-height", "px"],
    lockupHeightShort: [".onboarding-lockup", "min-height", "px", SHORT_MEDIA],
    paddingTop: [".onboarding-welcome", "padding-top", "px"],
    wordmarkFraction: [".onboarding-lockup .brand-wordmark", "width", "minPercent"],
    wordmarkWidth: [".onboarding-lockup .brand-wordmark", "width", "min"],
  },
};

/** The four edges of a 1–4 value shorthand, in CSS order (top, right, bottom, left). */
const edges = (value: string): readonly string[] => {
  const parts = value.match(/[^\s(]+(?:\([^)]*\))?/g) ?? [];
  const [a, b, c, d] = parts;
  if (a === undefined || parts.length > 4) {
    throw new Error(`Expected a 1–4 value shorthand, got ${value}`);
  }
  const right = b ?? a;
  return [a, right, c ?? a, d ?? right];
};

const edge = (value: string, index: number): number => evaluatePx(edges(value)[index] ?? "");

const read = (kind: Kind, value: string): string => {
  switch (kind) {
    case "px":
      return String(evaluatePx(value));
    case "min":
    case "minPercent": {
      const arm = /^min\((?:(\S+px), (\d+)%|(\d+)%, (\S+px))\)$/.exec(value);
      if (!arm) throw new Error(`Expected min(<px>, <percent>), got ${value}`);
      return kind === "min"
        ? String(evaluatePx(arm[1] ?? arm[4] ?? ""))
        : String(Number(arm[2] ?? arm[3]) / 100);
    }
    case "clampMin": {
      const floor = /^clamp\((\S+px),/.exec(value)?.[1];
      return String(evaluatePx(floor ?? value));
    }
    case "top":
      return String(edge(value, 0));
    case "trailing":
      return String(edge(value, 1));
    case "bottom":
      return String(edge(value, 2));
    case "leading":
      return String(edge(value, 3));
    case "insets": {
      const [top, trailing, bottom, leading] = edges(value).map(evaluatePx);
      return `EdgeInsets(top: ${top}, leading: ${leading}, bottom: ${bottom}, trailing: ${trailing})`;
    }
    case "em": {
      const em = /^(-?\d*\.?\d+)em$/.exec(value)?.[1];
      if (em === undefined && value !== "0") throw new Error(`Expected an em value, got ${value}`);
      return String(Number(em ?? 0));
    }
    case "ms": {
      const ms = /^[a-z-]+ (\d+)ms /.exec(value)?.[1];
      if (ms === undefined) throw new Error(`Expected an animation shorthand, got ${value}`);
      return ms;
    }
    case "weight":
    case "number": {
      if (!/^\d*\.?\d+$/.test(value)) throw new Error(`Expected a number, got ${value}`);
      return String(Number(value));
    }
  }
};

const swiftType = (kind: Kind): string =>
  kind === "insets"
    ? "EdgeInsets"
    : kind === "weight"
      ? "Int"
      : kind === "ms"
        ? "Double"
        : "CGFloat";

/** The Swift `BrambleMetrics` enum. */
export const renderSwiftMetrics = (rules: readonly CssRule[]): string[] => {
  const root = rootProperties(rules);
  const sortedKeys = <T>(record: Readonly<Record<string, T>>): [string, T][] =>
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    "/// Layout metrics read from the side panel's rendered stylesheet (`SIDEPANEL_STYLES`), per",
    "/// component: `…Phone` is the `max-width: 520px` rule, `…Short` the `max-height: 760px` one.",
    "enum BrambleMetrics {",
    ...sortedKeys({ ...LAYOUT_METRICS, ...SEND_LAYOUT_METRICS }).flatMap(([component, metrics]) => [
      `    enum ${component} {`,
      ...sortedKeys(metrics).map(([name, [selector, property, kind, media]]) => {
        const declared = declaredValue(rules, selector, property, media ? [media] : []);
        if (declared === undefined) {
          throw new Error(`${selector} has no ${property}${media ? ` in ${media}` : ""}`);
        }
        const value = read(kind, resolveVars(declared, root));
        return `        static let ${name}: ${swiftType(kind)} = ${value}`;
      }),
      "    }",
    ]),
    "}",
    "",
  ];
};
