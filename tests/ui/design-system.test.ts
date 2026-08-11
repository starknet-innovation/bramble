/**
 * Design-system anti-drift checks: every catalog item must have Storybook
 * coverage, registered assets stay unique, and shared string renderers escape
 * untrusted content while rejecting arbitrary HTML capabilities.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UI_COMPONENTS, UI_FOUNDATIONS } from "@mc-wallet/ui-kit/catalog";
import { emptyState, pill, receipt } from "@mc-wallet/ui-kit/content";
import { button, iconButton } from "@mc-wallet/ui-kit/controls";
import { darkSkin } from "@mc-wallet/ui-kit/dark-skin";
import { selectField, textField } from "@mc-wallet/ui-kit/fields";
import { uiAttributes } from "@mc-wallet/ui-kit/html-attributes";
import { ICON_NAMES } from "@mc-wallet/ui-kit/icons";
import type { WalletStatus } from "@mc-wallet/wallet-ui/lab";
import { onboarding } from "@mc-wallet/wallet-ui/lab";
import {
  COMPONENT_STORY_COVERAGE,
  FOUNDATION_STORY_COVERAGE,
} from "../../apps/ui-lab/src/runtime/catalog-coverage";
import { LAB_STYLES } from "../../apps/ui-lab/src/runtime/lab-styles";

const status: WalletStatus = {
  accountCount: 0,
  accounts: [],
  activeAccountId: null,
  hasVault: false,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe("design system", () => {
  test("documents every foundation and component in Storybook exactly once", () => {
    const foundations = UI_FOUNDATIONS.map((entry) => entry.id);
    const components = UI_COMPONENTS.map((entry) => entry.id);
    expect(new Set(foundations).size).toBe(foundations.length);
    expect(new Set(components).size).toBe(components.length);
    expect(sorted(FOUNDATION_STORY_COVERAGE)).toEqual(sorted(foundations));
    expect(sorted(COMPONENT_STORY_COVERAGE)).toEqual(sorted(components));
  });

  test("keeps the icon registry unique and catalogable", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(20);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  test("keeps review chrome on the production monochrome palette", () => {
    const emittedColors = [...LAB_STYLES.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(([color]) =>
      color.toLowerCase(),
    );
    const expectedColors = [
      "--mc-accent",
      "--mc-accent-text",
      "--mc-bg",
      "--mc-border",
      "--mc-danger",
      "--mc-elevated",
      "--mc-muted",
      "--mc-panel",
      "--mc-sunken",
      "--mc-text",
    ].map((name) => darkSkin.tokens[name as keyof typeof darkSkin.tokens]);
    expect(new Set(emittedColors)).toEqual(new Set(expectedColors));
  });

  test("keeps the provider test bench achromatic outside status semantics", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../examples/provider-tester/index.html"),
      "utf8",
    );
    for (const name of [
      "bg",
      "panel",
      "elevated",
      "border",
      "text",
      "muted",
      "accent",
      "accent-ink",
    ]) {
      const match = source.match(new RegExp(`--${name}: #([0-9a-fA-F]{6})`));
      expect(match, `missing --${name}`).not.toBeNull();
      const value = match?.[1] ?? "";
      expect(value.slice(0, 2), `--${name} must not carry a hue`).toBe(value.slice(2, 4));
      expect(value.slice(2, 4), `--${name} must not carry a hue`).toBe(value.slice(4, 6));
    }
    expect(source).toContain("--ok: #4ade80");
    expect(source).toContain("--danger: #ff7474");
  });

  test("escapes dynamic text across controls, fields, and content", () => {
    const unsafe = '<img src=x onerror="alert(1)">';
    const markup = [
      button({ label: unsafe }),
      iconButton({ icon: "copy", label: unsafe }),
      textField({ label: unsafe, name: "safe", value: unsafe }),
      selectField({
        label: unsafe,
        name: "select",
        options: [{ label: unsafe, value: unsafe }],
      }),
      emptyState(unsafe),
      pill(unsafe),
      receipt([{ label: unsafe, value: unsafe }]),
    ].join("");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });

  test("rejects arbitrary attribute and event-handler capabilities", () => {
    expect(() => uiAttributes({ onclick: "steal()" })).toThrow("Unsupported UI attribute");
    expect(() => uiAttributes({ style: "background:red" })).toThrow("Unsupported UI attribute");
    expect(() => button({ className: 'primary" onclick="steal()', label: "Unsafe" })).toThrow(
      "Unsupported UI class",
    );
  });

  test("keeps reusable primitive markup behind the production library", () => {
    const root = join(import.meta.dir, "../../packages/presentation/wallet-ui/src/sidepanel");
    const files = readdirSync(root, { encoding: "utf8", recursive: true }).filter((path) =>
      path.endsWith(".ts"),
    );
    const violations: string[] = [];
    for (const path of files) {
      const source = readFileSync(join(root, path), "utf8");
      if (/class="(?:empty|icon-button|menu-row|pill|receipt)(?:\s|")/.test(source)) {
        violations.push(`${path}: shared class`);
      }
      for (const field of source.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? []) {
        if (/<input\b[^>]*type="(?:checkbox|hidden)"/.test(field)) {
          continue;
        }
        violations.push(`${path}: ${field.slice(0, 48)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("full-screen onboarding consumes shared controls and defaults to Mainnet", () => {
    const markup = onboarding(status);
    expect(markup).toContain(
      button({
        attributes: { id: "create-new-button" },
        label: "Create a new wallet",
      }),
    );
    expect(markup).not.toContain("<select");
    expect(markup).toContain("Starknet Mainnet");
  });
});
