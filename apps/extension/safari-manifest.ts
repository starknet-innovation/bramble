/**
 * Derives the Safari Web Extension manifest from the Chrome MV3 manifest.
 *
 * Same rule as `./firefox-manifest.ts`: `public/manifest.json` is the single
 * definition, and this transform is allowlist-driven. Every top-level key of the
 * Chrome manifest must be classified here as shared, rewritten, or deliberately
 * Chrome-only, and an unclassified key throws, so a key added for Chrome cannot
 * reach Safari without someone deciding what Safari does with it.
 *
 * Safari runs the Chrome background as it is: it implements MV3 service workers
 * (Safari 15.4) and module workers (16.4). The divergences, each with its reason:
 *
 * - `side_panel` and the `sidePanel` permission are dropped. Safari has neither
 *   `sidePanel` nor `sidebarAction`, so the toolbar popup is the only wallet
 *   surface; the approval surface serves every choice as the popup on a browser
 *   with no panel API (see `approval-surface-control.ts`).
 * - `sandbox` and `content_security_policy.sandbox` are dropped, and the
 *   sandboxed collectible renderer is withheld from the package. Safari does not
 *   implement the `sandbox` key, so the page would load as an ordinary
 *   privileged extension page. Nothing is lost: the collectibles journey is
 *   parked. The Firefox build withholds it for the same reason.
 * - `browser_specific_settings.safari.strict_min_version` is added. See
 *   {@link SAFARI_MIN_VERSION}: it is a security floor, not a compatibility guess.
 *
 * Packaging differs from every other target: Safari loads web extensions only
 * from inside a signed macOS app. The output of this target is the input to
 * Apple's `safari-web-extension-converter`, and the app wrapper, signing and
 * App Store submission happen in Xcode (RELEASING.md, "Safari").
 */

import { type Manifest, PANEL_PERMISSIONS, requireRecord } from "./firefox-manifest";

/**
 * Oldest Safari this build installs on.
 *
 * 27.2 is the first Safari that implements `storage.setAccessLevel` on every
 * storage area. From 17.1 to 27.1 it covered `storage.session` only (MDN
 * browser-compat-data, `webextensions.api.storage.StorageArea.setAccessLevel`).
 * The wallet refuses to start unless `local`, `session` and `sync` are all
 * closed to content scripts (`requireTrustedStorageAccess`), and this target
 * keeps that rule strict, so a lower floor would install a wallet that cannot
 * start. Lowering it means accepting Firefox's weaker storage posture on Safari,
 * which is a security decision, not a version bump.
 */
export const SAFARI_MIN_VERSION = "27.2";

/** Keys copied verbatim: Safari implements each at {@link SAFARI_MIN_VERSION}. */
const SHARED_KEYS = [
  "manifest_version",
  "name",
  "version",
  "description",
  "author",
  "homepage_url",
  "icons",
  "action",
  "background",
  "content_scripts",
  "host_permissions",
  "optional_host_permissions",
  "options_ui",
  "web_accessible_resources",
] as const;

/** Keys replaced with a Safari form rather than copied. */
const REWRITTEN_KEYS = ["content_security_policy", "permissions"] as const;

/** Keys intentionally absent from the Safari manifest; see the module comment. */
const CHROME_ONLY_KEYS = ["side_panel", "sandbox"] as const;

const requireEveryKeyClassified = (chrome: Manifest): void => {
  const classified = new Set<string>([...SHARED_KEYS, ...REWRITTEN_KEYS, ...CHROME_ONLY_KEYS]);
  const unclassified = Object.keys(chrome).filter((key) => !classified.has(key));
  if (unclassified.length > 0) {
    throw new Error(
      `chrome manifest keys are unclassified for Safari: ${unclassified.sort().join(", ")}. ` +
        "Add each to SHARED_KEYS, REWRITTEN_KEYS, or CHROME_ONLY_KEYS in apps/extension/safari-manifest.ts.",
    );
  }
};

const permissions = (chrome: Manifest): readonly string[] => {
  const declared = chrome["permissions"];
  if (!Array.isArray(declared) || declared.some((entry) => typeof entry !== "string")) {
    throw new Error("chrome manifest permissions must be an array of strings");
  }
  return (declared as readonly string[]).filter((permission) => !PANEL_PERMISSIONS.has(permission));
};

/**
 * Produces the Safari manifest for a parsed Chrome manifest. Throws on an
 * unclassified top-level key or a rewritten key of the wrong shape. Pure, so the
 * build, the manifest gate and the tests derive the same bytes.
 */
export const toSafariManifest = (chrome: Manifest): Record<string, unknown> => {
  requireEveryKeyClassified(chrome);
  const declaredPolicy = requireRecord(
    chrome["content_security_policy"],
    "content_security_policy",
  );
  // Fail closed: a missing policy would let Safari fall back to its default.
  if (typeof declaredPolicy["extension_pages"] !== "string") {
    throw new Error("chrome manifest content_security_policy.extension_pages must be a string");
  }
  const shared = Object.fromEntries(
    SHARED_KEYS.filter((key) => key in chrome).map((key) => [key, chrome[key]]),
  );
  return {
    ...shared,
    content_security_policy: { extension_pages: declaredPolicy["extension_pages"] },
    permissions: permissions(chrome),
    browser_specific_settings: { safari: { strict_min_version: SAFARI_MIN_VERSION } },
  };
};
