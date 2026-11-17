/**
 * The Ready key notice: shown only for an affected account, states the
 * consequence once, and opens the existing reveal flow for the active account.
 */
import { describe, expect, test } from "bun:test";
import { readyKeyNotice } from "../../../../src/sidepanel/journeys/portfolio/ready-key-notice";

describe("Ready key notice", () => {
  test("renders nothing for an unaffected account", () => {
    expect(readyKeyNotice(false)).toBe("");
  });

  test("states the consequence and opens the reveal flow", () => {
    const markup = readyKeyNotice(true);
    expect(markup).toContain("Back up this account's key");
    expect(markup).toContain("Restoring your phrase won't find this account.");
    expect(markup).toContain('data-view="reveal"');
    expect(markup).toContain(">Back up key</button>");
    // One action only: no second control competing with the backup.
    expect(markup.match(/<button/g)).toHaveLength(1);
  });
});
