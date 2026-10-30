/**
 * The mobile generators read elevation tiers, press scales, layout metrics and component colours
 * from the side panel's rendered stylesheet (design-mobile.md 2.2). These tests pin the reader's
 * strictness on fixture CSS — an unknown shadow, an unlisted elevation, an unresolved alias, or an
 * unsupported length must fail generation — and check the real stylesheet's current tiers.
 */
import { describe, expect, test } from "bun:test";
import { SHADOW } from "@bramble/ui-kit/tokens";
import { SIDEPANEL_STYLES } from "../../packages/presentation/wallet-ui/src/sidepanel/styles/index";
import { declaredValue, evaluatePx, parseCss, resolveVars } from "../../scripts/mobile-assets/css";
import {
  ELEVATION_COMPONENTS,
  readElevation,
  readPressScales,
} from "../../scripts/mobile-assets/elevation";
import { renderSwiftMetrics } from "../../scripts/mobile-assets/metrics";

const ROOT = `:root { --bramble-elev-xs: ${SHADOW.xs}; --bramble-elev-sm: ${SHADOW.sm}; --bramble-elev-md: ${SHADOW.md}; --bramble-elev-lg: ${SHADOW.lg}; --bramble-shadow-sm: var(--bramble-elev-sm); }`;

/** Every listed component with a tier, so fixture CSS passes the "listed selector" check. */
const LISTED = Object.values(ELEVATION_COMPONENTS)
  .map((selector) => `${selector} { box-shadow: var(--bramble-elev-sm); }`)
  .join("\n");

describe("stylesheet reader", () => {
  test("parses media conditions and keyframe steps", () => {
    const rules = parseCss(
      "a { color: red; } @media (max-width: 520px) { a { gap: 4px; } } @keyframes k { 50% { opacity: 0.4; } }",
    );
    expect(declaredValue(rules, "a", "gap")).toBeUndefined();
    expect(declaredValue(rules, "a", "gap", ["(max-width: 520px)"])).toBe("4px");
    expect(declaredValue(rules, "50%", "opacity", ["@keyframes k"])).toBe("0.4");
  });

  test("resolves aliases and evaluates calc()", () => {
    const rules = parseCss(ROOT);
    expect(
      resolveVars(
        "var(--bramble-shadow-sm)",
        new Map([
          ["--bramble-shadow-sm", "var(--x)"],
          ["--x", "1px"],
        ]),
      ),
    ).toBe("1px");
    expect(() => resolveVars("var(--missing)", new Map())).toThrow("Unresolved");
    expect(evaluatePx("calc(calc(44px + 6px * 2 + 16px) + 12px)")).toBe(84);
    expect(() => evaluatePx("calc(100% - 4px)")).toThrow();
    expect(rules.length).toBe(1);
  });
});

describe("elevation", () => {
  test("a literal SHADOW value and the shadow-sm alias both resolve to their tier", () => {
    const rules = parseCss(
      `${ROOT}\n${LISTED}\n.send-task-list { box-shadow: ${SHADOW.xs}; }\n.toast { box-shadow: var(--bramble-shadow-sm); }`,
    );
    const tiers = new Map(readElevation(rules).map((entry) => [entry.name, entry.base]));
    expect(tiers.get("sendTaskList")).toBe("xs");
    expect(tiers.get("toast")).toBe("sm");
  });

  test("a phone-width override becomes a phone variant", () => {
    const rules = parseCss(
      `${ROOT}\n${LISTED}\n@media (max-width: 520px) { .onboarding-wizard, .onboarding-complete { box-shadow: none; } }`,
    );
    const wizard = readElevation(rules).find((entry) => entry.name === "onboardingWizard");
    expect(wizard).toEqual({ base: "sm", name: "onboardingWizard", phone: "none" });
  });

  test("an unknown shadow value fails", () => {
    const rules = parseCss(`${ROOT}\n${LISTED}\n.toast { box-shadow: 0 2px 3px black; }`);
    expect(() => readElevation(rules)).toThrow("not a SHADOW tier");
  });

  test("an unlisted elevation fails; rings and insets are ignored", () => {
    const ok = parseCss(
      `${ROOT}\n${LISTED}\n.ring { box-shadow: 0 0 0 1px var(--bramble-hairline); }\n.line { box-shadow: inset 0 1px 0 var(--bramble-hairline); }`,
    );
    expect(() => readElevation(ok)).not.toThrow();
    const bad = parseCss(`${ROOT}\n${LISTED}\n.new-card { box-shadow: var(--bramble-elev-md); }`);
    expect(() => readElevation(bad)).toThrow("Unlisted elevation .new-card");
  });

  test("a listed selector without a rule fails", () => {
    expect(() => readElevation(parseCss(ROOT))).toThrow("has no box-shadow rule");
  });

  test("the real stylesheet's tiers", () => {
    const rules = parseCss(SIDEPANEL_STYLES);
    const tiers = Object.fromEntries(readElevation(rules).map((entry) => [entry.name, entry]));
    expect(tiers["dock"]?.base).toBe("md");
    expect(tiers["toast"]?.base).toBe("lg");
    expect(tiers["segmentSelected"]?.base).toBe("xs");
    expect(tiers["onboardingWizard"]).toEqual({
      base: "md",
      name: "onboardingWizard",
      phone: "none",
    });
    for (const { scale } of readPressScales(rules)) {
      expect(scale).toBeGreaterThanOrEqual(0.95);
      expect(scale).toBeLessThanOrEqual(1);
    }
  });
});

describe("layout metrics", () => {
  test("every metric reads from the real stylesheet", () => {
    const lines = renderSwiftMetrics(parseCss(SIDEPANEL_STYLES));
    expect(lines).toContain("        static let height: CGFloat = 72");
    expect(lines).toContain("        static let optionHeight: CGFloat = 34");
  });

  test("a missing rule fails rather than emitting a guess", () => {
    expect(() => renderSwiftMetrics(parseCss(".action-row { gap: 8px; }"))).toThrow("has no");
  });
});
