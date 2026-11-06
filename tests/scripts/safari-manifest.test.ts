/**
 * Contract for the derived Safari manifest.
 *
 * Like the Gecko manifest, the Safari one is computed from
 * `apps/extension/public/manifest.json`, so these cases assert the derivation
 * against the REAL manifest. They pin what Safari changes and why: no panel
 * surface, no sandboxed renderer, and a minimum version that is a storage
 * security floor rather than a compatibility guess.
 */
import { describe, expect, test } from "bun:test";
import { outputDirectory } from "../../apps/extension/build-target";
import { type Manifest, shipsSandboxedRenderer } from "../../apps/extension/firefox-manifest";
import { SAFARI_MIN_VERSION, toSafariManifest } from "../../apps/extension/safari-manifest";
import { lockdownIsEnforceable } from "../../apps/extension/src/browser-storage";
import {
  EXPECTED_RUNTIME_FILES,
  FIREFOX_RUNTIME_FILES,
  runtimeFilesFor,
  SAFARI_RUNTIME_FILES,
} from "../../scripts/extension-runtime-files";

const chromeManifest = async (): Promise<Manifest> =>
  JSON.parse(await Bun.file("apps/extension/public/manifest.json").text()) as Manifest;

const safariManifest = async (): Promise<Record<string, unknown>> =>
  toSafariManifest(await chromeManifest());

describe("safari manifest derivation", () => {
  // Named literally: the exhaustiveness guard proves a key is classified, not
  // that it landed in the right list. Moving these to the Chrome-only list
  // yields a Safari wallet no dapp can reach.
  test("copies every shared key through, including the service-worker background", async () => {
    const chrome = await chromeManifest();
    const manifest = await safariManifest();
    for (const key of [
      "manifest_version",
      "name",
      "version",
      "description",
      "icons",
      "action",
      "author",
      "homepage_url",
      "background",
      "content_scripts",
      "host_permissions",
      "optional_host_permissions",
      "options_ui",
      "web_accessible_resources",
    ]) {
      expect(manifest[key], key).toEqual(chrome[key]);
    }
  });

  test("refuses a chrome manifest key no one has classified for safari", async () => {
    const grown = { ...(await chromeManifest()), declarative_net_request: {} };
    expect(() => toSafariManifest(grown)).toThrow(
      /unclassified for Safari: declarative_net_request/,
    );
  });

  test("declares no panel surface and no panel permission", async () => {
    const manifest = await safariManifest();
    expect(manifest["side_panel"]).toBeUndefined();
    expect(manifest["sidebar_action"]).toBeUndefined();
    expect(manifest["permissions"]).toEqual(["alarms", "storage"]);
  });

  test("ships no sandbox page and keeps only the extension-page policy", async () => {
    const chrome = await chromeManifest();
    const manifest = await safariManifest();
    expect(manifest["sandbox"]).toBeUndefined();
    const chromePolicy = chrome["content_security_policy"] as Record<string, unknown>;
    expect(manifest["content_security_policy"]).toEqual({
      extension_pages: chromePolicy["extension_pages"],
    });
    expect(shipsSandboxedRenderer("safari")).toBe(false);
    expect(SAFARI_RUNTIME_FILES).not.toContain("sandbox/render.html");
    expect(SAFARI_RUNTIME_FILES).not.toContain("sandbox/render.js");
  });

  // The floor and the strict storage lockdown are one decision: below 27.2
  // Safari can only close storage.session, and the wallet refuses to start.
  test("pins the safari floor that makes the strict storage lockdown hold", async () => {
    const manifest = await safariManifest();
    expect(SAFARI_MIN_VERSION).toBe("27.2");
    expect(manifest["browser_specific_settings"]).toEqual({
      safari: { strict_min_version: SAFARI_MIN_VERSION },
    });
    expect(lockdownIsEnforceable("safari")).toBe(true);
  });

  test("packages the pinned per-target file sets", () => {
    expect(runtimeFilesFor("chrome")).toBe(EXPECTED_RUNTIME_FILES);
    expect(runtimeFilesFor("firefox")).toBe(FIREFOX_RUNTIME_FILES);
    expect(runtimeFilesFor("safari")).toBe(SAFARI_RUNTIME_FILES);
    expect(outputDirectory("safari")).toBe("dist-safari");
  });

  test("refuses a content security policy that is not an object", async () => {
    const broken = { ...(await chromeManifest()), content_security_policy: "default-src 'self'" };
    expect(() => toSafariManifest(broken)).toThrow(/content_security_policy must be an object/);
  });

  test("refuses a policy without an extension-page entry rather than ship none", async () => {
    const chrome = await chromeManifest();
    const policy = chrome["content_security_policy"] as Record<string, unknown>;
    const broken = { ...chrome, content_security_policy: { sandbox: policy["sandbox"] } };
    expect(() => toSafariManifest(broken)).toThrow(/extension_pages must be a string/);
  });
});
