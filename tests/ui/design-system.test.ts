/**
 * Design-system anti-drift checks: every catalog item must have Storybook
 * coverage, registered assets stay unique, and shared string renderers escape
 * untrusted content while rejecting arbitrary HTML capabilities.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UI_COMPONENTS, UI_FOUNDATIONS } from "@bramble/ui-kit/catalog";
import { emptyState, pill, receipt } from "@bramble/ui-kit/content";
import { button, iconButton } from "@bramble/ui-kit/controls";
import { darkSkin } from "@bramble/ui-kit/dark-skin";
import { selectField, textField } from "@bramble/ui-kit/fields";
import { uiAttributes } from "@bramble/ui-kit/html-attributes";
import { ICON_NAMES } from "@bramble/ui-kit/icons";
import type { WalletStatus } from "@bramble/wallet-ui/lab";
import { onboarding } from "@bramble/wallet-ui/lab";
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

  test("keeps review chrome on the production palette", () => {
    const emittedColors = [...LAB_STYLES.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(([color]) =>
      color.toLowerCase(),
    );
    const expectedColors = [
      "--bramble-accent",
      "--bramble-accent-text",
      "--bramble-bg",
      "--bramble-border",
      "--bramble-danger",
      "--bramble-elevated",
      "--bramble-muted",
      "--bramble-panel",
      "--bramble-sunken",
      "--bramble-text",
    ].map((name) => darkSkin.tokens[name as keyof typeof darkSkin.tokens]);
    expect(new Set(emittedColors)).toEqual(new Set(expectedColors));
  });

  test("keeps the provider test bench on the production dark palette", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../examples/provider-tester/index.html"),
      "utf8",
    );
    // The bench is a standalone page, so its palette is hand-copied from the
    // default skin; this pins every role to the skin token it mirrors.
    const roles: ReadonlyArray<[string, keyof typeof darkSkin.tokens]> = [
      ["bg", "--bramble-bg"],
      ["panel", "--bramble-panel"],
      ["elevated", "--bramble-elevated"],
      ["border", "--bramble-border"],
      ["text", "--bramble-text"],
      ["muted", "--bramble-muted"],
      ["accent", "--bramble-accent"],
      ["accent-ink", "--bramble-accent-text"],
      ["danger", "--bramble-danger"],
      ["ok", "--bramble-positive"],
    ];
    for (const [name, tokenName] of roles) {
      expect(source, `--${name} must mirror ${tokenName}`).toContain(
        `--${name}: ${darkSkin.tokens[tokenName]};`,
      );
    }
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

  test("full-screen onboarding consumes shared controls and pins the Bramble account", () => {
    const markup = onboarding(status);
    expect(markup).toContain(
      button({
        attributes: { id: "create-new-button" },
        label: "Create a new wallet",
      }),
    );
    // Creation flows pin the Bramble account: no contract chooser remains.
    expect(markup).not.toContain('aria-label="Account contract"');
    expect(markup).not.toContain("data-account-contract=");
    expect(markup).toContain('name="accountContractType" type="hidden" value="openzeppelin"');
    // The private-key import keeps the contract choice for existing accounts.
    expect(markup).toContain('id="key-method-button"');
    expect(markup).toContain("Ready Account");
    expect(markup).toContain("Bramble Account");
    // The real-funds tickbox is gone, but its consequence is stated instead, on
    // every step that creates, imports or restores accounts on Mainnet (the
    // binder pins onboarding to DEFAULT_NETWORK).
    expect(markup).not.toContain('type="checkbox" name="mainnetAck"');
    const consequence = "This wallet is on Starknet Mainnet and holds real funds.";
    for (const step of ["import-key", "recovery-accounts", "accounts", "ledger"]) {
      const section =
        markup.split(`data-onboarding-step="${step}"`)[1]?.split("</section>")[0] ?? "";
      expect(section).toContain(consequence);
    }
  });
});
