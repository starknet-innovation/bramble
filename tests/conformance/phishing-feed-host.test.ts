/**
 * The live phishing feed is fetched from {@link DEFAULT_PHISHING_FEED_URL}, so
 * the shipped manifest must grant that exact origin. The old default sat on a
 * host that went 404 while the manifest still granted it, and nothing noticed
 * (issue 772); this pins the source and the grant together.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_PHISHING_FEED_URL } from "@bramble/permissions/phishing-feed";

const hostPermissions = async (): Promise<readonly string[]> =>
  (
    JSON.parse(await Bun.file("apps/extension/public/manifest.json").text()) as {
      readonly host_permissions: readonly string[];
    }
  ).host_permissions;

describe("phishing feed host", () => {
  test("the default feed is HTTPS and its origin is a declared host permission", async () => {
    const feed = new URL(DEFAULT_PHISHING_FEED_URL);
    expect(feed.protocol).toBe("https:");
    expect(await hostPermissions()).toContain(`${feed.origin}/*`);
  });

  test("the retired GitHub Pages host is no longer granted", async () => {
    expect(await hostPermissions()).not.toContain("https://metamask.github.io/*");
  });
});
