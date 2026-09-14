/**
 * Contract for the derived Firefox manifest.
 *
 * The Gecko manifest has no file of its own: it is computed from
 * `apps/extension/public/manifest.json`, so these cases are what stops the two
 * browsers' declarations from drifting apart. They assert the derivation
 * against the REAL manifest rather than a fixture, so a change to the shipped
 * Chrome manifest is what fails here, and they pin the four divergences that
 * exist for a reason — the background environment, the panel surface, the
 * `sidePanel` permission, and the sandboxed collectible renderer — plus the
 * exhaustiveness rule that refuses to guess about a key nobody has classified.
 */
import { describe, expect, test } from "bun:test";
import {
  FIREFOX_DATA_COLLECTION_PERMISSIONS,
  FIREFOX_EXTENSION_ID,
  FIREFOX_MIN_VERSION,
  FIREFOX_NAME_LIMIT,
  type Manifest,
  toFirefoxManifest,
} from "../../apps/extension/firefox-manifest";

const chromeManifest = async (): Promise<Manifest> =>
  JSON.parse(await Bun.file("apps/extension/public/manifest.json").text()) as Manifest;

const firefoxManifest = async (): Promise<Record<string, unknown>> =>
  toFirefoxManifest(await chromeManifest());

describe("firefox manifest derivation", () => {
  // Named literally rather than derived from SHARED_KEYS. The exhaustiveness
  // guard only proves a key is CLASSIFIED, not that it landed in the right
  // list: moving these four to CHROME_ONLY_KEYS yields a Firefox wallet that
  // injects no content script, requests no hosts and exposes no provider — a
  // wallet no dapp can reach — and every other gate stays green.
  test("copies every shared key through to the gecko manifest", async () => {
    const chrome = await chromeManifest();
    const manifest = await firefoxManifest();
    for (const key of [
      "manifest_version",
      "name",
      "version",
      "description",
      "icons",
      "action",
      "content_scripts",
      "host_permissions",
      "optional_host_permissions",
      "web_accessible_resources",
      "content_security_policy",
      "sandbox",
    ]) {
      expect(manifest[key], key).toEqual(chrome[key]);
    }
  });

  test("derives from the shipped chrome manifest without unclassified keys", async () => {
    const chrome = await chromeManifest();
    expect(() => toFirefoxManifest(chrome)).not.toThrow();
  });

  test("refuses a chrome manifest key no one has classified for firefox", async () => {
    const grown = { ...(await chromeManifest()), declarative_net_request: {} };
    expect(() => toFirefoxManifest(grown)).toThrow(
      /unclassified for Firefox: declarative_net_request/,
    );
  });

  test("runs the background as an event page, never a service worker", async () => {
    const manifest = await firefoxManifest();
    expect(manifest["background"]).toEqual({
      scripts: ["background/index.js"],
      type: "module",
    });
  });

  test("carries the declared module type rather than assuming one", async () => {
    const classic = {
      ...(await chromeManifest()),
      background: { service_worker: "background/index.js" },
    };
    expect(
      (toFirefoxManifest(classic)["background"] as Record<string, unknown>)["type"],
    ).toBeUndefined();
  });

  test("refuses a background entry the event page would not load", async () => {
    const moved = {
      ...(await chromeManifest()),
      background: { service_worker: "worker.js", type: "module" },
    };
    expect(() => toFirefoxManifest(moved)).toThrow(/background.service_worker/);
  });

  test("replaces the chrome side panel with the gecko sidebar on the same document", async () => {
    const manifest = await firefoxManifest();
    const chrome = await chromeManifest();
    const sidePanel = chrome["side_panel"] as { readonly default_path: string };
    expect(manifest["side_panel"]).toBeUndefined();
    expect(manifest["sidebar_action"]).toEqual({
      default_panel: sidePanel.default_path,
      default_title: (chrome["action"] as Record<string, unknown>)["default_title"],
      default_icon: (chrome["action"] as Record<string, unknown>)["default_icon"],
      open_at_install: false,
    });
  });

  test("drops the chrome-only sidePanel permission and keeps the rest", async () => {
    const manifest = await firefoxManifest();
    expect(manifest["permissions"]).toEqual(["alarms", "storage"]);
    expect(manifest["permissions"]).not.toContain("sidePanel");
  });

  // The reason the floor is 154: below it Firefox ignores this key and the
  // collectible renderer — which runs untrusted on-chain HTML — would load as
  // an ordinary privileged extension page. Shipped identically to Chrome or
  // not at all; there is no safe middle.
  test("declares the collectible renderer as a sandboxed page, exactly as chrome does", async () => {
    const chrome = await chromeManifest();
    const manifest = await firefoxManifest();
    expect(manifest["sandbox"]).toEqual(chrome["sandbox"]);
    expect(manifest["content_security_policy"]).toEqual(chrome["content_security_policy"]);
    expect(
      (manifest["content_security_policy"] as Record<string, unknown>)["sandbox"],
    ).toBeDefined();
    expect(Number.parseFloat(FIREFOX_MIN_VERSION)).toBeGreaterThanOrEqual(154);
  });

  // The literals, not the constants. Comparing the derived manifest against the
  // very constants it was built from cannot fail, and a changed add-on id is
  // not a cosmetic edit: Firefox keys stored data by id, so shipping a new one
  // hands every existing user an empty vault.
  test("publishes under the add-on identity users already have", () => {
    expect(FIREFOX_EXTENSION_ID).toBe("bramble@starknet.org");
  });

  // The release that added the `sandbox` manifest key. Lowering this ships the
  // collectible renderer as a privileged page — or, if the renderer is withheld
  // again, a Firefox build without it. Both are decisions, not edits.
  test("requires the first firefox that can sandbox the renderer", () => {
    expect(FIREFOX_MIN_VERSION).toBe("154.0");
  });

  // A public statement of data practice. addons.mozilla.org refuses to sign a
  // submission without it, and the schema rejects an empty `required` — the
  // "no collection" case is the "none" sentinel, not an empty list.
  test("declares its data collection exactly as reviewed", () => {
    expect(FIREFOX_DATA_COLLECTION_PERMISSIONS).toEqual({
      required: ["none"],
      optional: ["technicalAndInteraction"],
    });
  });

  test("binds the add-on to its gecko identity, floor, and consent declaration", async () => {
    expect((await firefoxManifest())["browser_specific_settings"]).toEqual({
      gecko: {
        id: FIREFOX_EXTENSION_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        data_collection_permissions: FIREFOX_DATA_COLLECTION_PERMISSIONS,
      },
    });
  });

  test("refuses a name addons.mozilla.org would reject", async () => {
    const chrome = await chromeManifest();
    expect(FIREFOX_NAME_LIMIT).toBe(45);
    expect(() =>
      toFirefoxManifest({ ...chrome, name: "B".repeat(FIREFOX_NAME_LIMIT + 1) }),
    ).toThrow(/at most 45 characters/);
    expect(() =>
      toFirefoxManifest({ ...chrome, name: "B".repeat(FIREFOX_NAME_LIMIT) }),
    ).not.toThrow();
  });
});
