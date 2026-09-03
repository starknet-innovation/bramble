/** Verifies public-link validation and support-copy safety boundaries. */
import { describe, expect, test } from "bun:test";
import { CHROME_STORE_ROOT, createSupportIssueUrl, resolveChromeStoreUrl } from "./site-links";

describe("site links", () => {
  test("accepts only Chrome Web Store HTTPS listing URLs", () => {
    expect(resolveChromeStoreUrl("https://chromewebstore.google.com/detail/bramble/id")).toBe(
      "https://chromewebstore.google.com/detail/bramble/id",
    );
    expect(resolveChromeStoreUrl("https://example.com/not-the-store")).toBe(CHROME_STORE_ROOT);
  });

  test("keeps support questions bounded and warns against sharing secrets", () => {
    const url = new URL(createSupportIssueUrl(`  ${"a".repeat(2_100)}  `));
    expect(url.hostname).toBe("github.com");
    expect(url.searchParams.get("title")?.length).toBe(120);
    expect(url.searchParams.get("body")).toContain("Please do not include recovery phrases");
  });
});
