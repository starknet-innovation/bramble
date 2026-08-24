/** Compact intent-list rendering keeps every library input inert. */
import { expect, test } from "bun:test";
import { compactIntentListView } from "../../../../src/sidepanel/journeys/multisig/multisig-intent-list";

test("escapes library-supplied compact-list headings", () => {
  const html = compactIntentListView(
    '<img src=x onerror="alert(1)">',
    [
      {
        accountId: "SN_MAIN:0x123",
        assets: [],
        id: "intent-1",
        label: "Review transfer",
        supportingText: "Awaiting signatures",
      },
    ],
    "No intents",
  );

  expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  expect(html).not.toContain("<img src=x");
});
