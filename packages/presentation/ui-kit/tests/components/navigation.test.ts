/**
 * Navigation primitives keep the wallet dock accessible while rendering count
 * badges only for actionable positive counts.
 */
import { describe, expect, test } from "bun:test";
import { dockNavigation, optionRow } from "@bramble/ui-kit/navigation";

describe("dockNavigation", () => {
  test("renders persistent labelled tabs and positive count badges", () => {
    const html = dockNavigation([
      {
        controls: "wallet-screen-home",
        count: 2,
        icon: "wallet",
        label: "Home",
        selected: true,
      },
      {
        attributes: { "data-view": "activity" },
        controls: "wallet-screen-activity",
        count: 0,
        icon: "activity",
        label: "Activity & approvals",
        selected: false,
      },
    ]);

    expect(html).toContain('aria-label="Home"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-view="activity"');
    expect(html).toContain('<span class="nav-label">Activity &amp; approvals</span>');
    expect(html).toContain(">2</span>");
    expect(html).not.toContain(">0</span>");
  });

  test("renders selectable rows with escaped supporting content", () => {
    const html = optionRow({
      attributes: { "data-add-kind": "multisig" },
      icon: "users",
      label: "Multisig <Account>",
      pressed: true,
      supportingText: "Create & add existing",
      value: "Shared",
    });

    expect(html).toContain('data-add-kind="multisig"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Multisig &lt;Account&gt;");
    expect(html).toContain("Create &amp; add existing");
    expect(html).toContain("Shared");
  });
});
