/**
 * The live phishing feed is read from {@link DEFAULT_PHISHING_FEED_URL} without
 * a host permission: the file allows any origin and the extension CSP allows
 * HTTPS connections. Granting its host would add a host the installed version
 * never had, which Chrome treats as a privilege increase and answers by
 * disabling the wallet on update until each user re-approves it (issue 772).
 * The retired GitHub Pages host stays out too.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_PHISHING_FEED_URL } from "@bramble/permissions/phishing-feed";

const manifest = async (): Promise<{
  readonly content_security_policy: { readonly extension_pages: string };
  readonly host_permissions: readonly string[];
}> => JSON.parse(await Bun.file("apps/extension/public/manifest.json").text());

describe("phishing feed host", () => {
  test("the default feed is HTTPS, which the extension CSP lets the worker reach", async () => {
    const feed = new URL(DEFAULT_PHISHING_FEED_URL);
    expect(feed.protocol).toBe("https:");
    expect((await manifest()).content_security_policy.extension_pages).toMatch(
      /connect-src[^;]*\shttps:(\s|;)/,
    );
  });

  test("no host permission is granted for the feed, old or new", async () => {
    const hosts = (await manifest()).host_permissions;
    expect(hosts).not.toContain(`${new URL(DEFAULT_PHISHING_FEED_URL).origin}/*`);
    expect(hosts).not.toContain("https://metamask.github.io/*");
  });
});
