/**
 * The live phishing feed is read from {@link DEFAULT_PHISHING_FEED_URL} without
 * a host permission: the file allows any origin and the extension CSP allows
 * HTTPS connections. Granting its host would add a host the installed version
 * never had, which Chrome treats as a privilege increase: the update can disable
 * the wallet for users whose existing grants don't cover it (issue 772).
 * The retired GitHub Pages host stays out too.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_PHISHING_FEED_URL } from "@bramble/permissions/phishing-feed";
import { type Manifest, toFirefoxManifest } from "../../apps/extension/firefox-manifest";

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

  test("the feed is the maintained eth-phishing-detect list", () => {
    expect(DEFAULT_PHISHING_FEED_URL).toBe(
      "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json",
    );
  });

  test("no host permission is granted for the feed, old or new, in Chrome or Firefox", async () => {
    const chrome = await manifest();
    const firefox = toFirefoxManifest(chrome as unknown as Manifest) as unknown as {
      readonly host_permissions?: readonly string[];
    };
    for (const hosts of [chrome.host_permissions, firefox.host_permissions ?? []]) {
      expect(hosts.some((host) => host.includes("github"))).toBe(false);
    }
  });
});
