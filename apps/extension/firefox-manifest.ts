/**
 * Derives the Firefox (Gecko) extension manifest from the Chrome MV3 manifest.
 *
 * `public/manifest.json` stays the single definition of the extension's shape.
 * Firefox implements a different half of MV3 — no service worker, no side panel
 * — so a second hand-written manifest would drift the moment either file
 * changed. This transform is therefore
 * allowlist-driven: every top-level key of the Chrome manifest must be
 * classified here as shared, rewritten, or deliberately Chrome-only, and an
 * unclassified key throws. Adding a key to `public/manifest.json` without
 * deciding what Firefox does with it fails the build rather than shipping a
 * manifest Firefox silently ignores.
 *
 * The divergences, each with the reason it is not a matter of taste:
 *
 * - `background.service_worker` → `background.scripts`. Firefox does not
 *   implement extension service workers (bugzil.la/1573659); it runs MV3
 *   backgrounds as non-persistent event pages. The background bundle is already
 *   written for a terminating worker — listeners registered at the top level,
 *   state in storage, wakeups through `alarms` — which is exactly what an event
 *   page requires, so the same bundle serves both.
 * - `side_panel` + the `sidePanel` permission → `sidebar_action`. Firefox has
 *   no `sidePanel` API; `sidebar_action` is its equivalent surface and needs no
 *   permission. The panel document itself is unchanged.
 * - `sandbox` and `content_security_policy.sandbox` are dropped, and
 *   `sandbox/render.html` is withheld from the package entirely. Firefox gained
 *   the `sandbox` key in 154; below that it is ignored, and that page — which
 *   runs untrusted on-chain HTML — would load as an ordinary privileged
 *   extension page. A page sandboxed on one browser and privileged on another
 *   is the kind of difference that stays invisible until it matters, so where
 *   the manifest cannot sandbox it, it does not ship. Nothing is lost: the
 *   collectibles journey is parked and no view can reach the gallery.
 * - `browser_specific_settings` is added. The add-on id is what binds this
 *   build to its stored data and its AMO listing, and `strict_min_version`
 *   refuses installation on releases whose MV3 support this manifest assumes.
 */

/** A parsed manifest. Values stay `unknown`; this module rewrites shape, not meaning. */
export type Manifest = Readonly<Record<string, unknown>>;

/**
 * The add-on id Firefox binds this extension's stored data to. Firefox keys
 * `storage.local`, `storage.sync`, and the extension origin by this id, so it
 * must never change for a published build: a new id is a new extension whose
 * vault is empty.
 */
export const FIREFOX_EXTENSION_ID = "bramble@starknet.org";

/**
 * Oldest Firefox this build supports: the current ESR, and so the oldest
 * release Mozilla still serves. Both ESR lines, the release channel, and the
 * forks that track either are above it.
 *
 * 140 is also the first release that understands
 * {@link FIREFOX_DATA_COLLECTION_PERMISSIONS}. A floor below that would ship a
 * consent declaration the browser cannot honour, so this is the lowest honest
 * value rather than merely a conservative one.
 *
 * The floor and the collectibles gallery are ONE decision. It was 154 — above
 * both ESR lines — while the sandboxed renderer shipped, because Firefox gained
 * the `sandbox` manifest key there. That renderer is now withheld (see
 * {@link shipsSandboxedRenderer}) because the journey is parked. Un-parking the
 * gallery means raising this back to 154 and excluding ESR again; it is not a
 * change that can be made on the UI side alone.
 *
 * Desktop only. No `gecko_android` key is declared, which is how an add-on
 * declines Android compatibility. Gecko has no sidebar on Android at all —
 * `sidebar_action` and the `sidebarAction` API are both absent there — so the
 * wallet's primary surface could not render. Android is a future native app,
 * not this package: do not add `gecko_android`.
 */
export const FIREFOX_MIN_VERSION = "140.0";

/**
 * What this extension tells Firefox it collects, shown to the user at install.
 *
 * Mozilla has required this of every new extension since 3 November 2025, and
 * AMO refuses to sign a submission without it — so it is not optional, and an
 * empty or absent value is a failed release rather than a quiet default.
 *
 * `required` is empty because nothing is collected as a condition of use, and
 * `technicalAndInteraction` is optional because product analytics are opt-in:
 * when enabled they send an installation id, app version, platform, release
 * channel, and a flow id to the wallet's own gateway and nowhere else (see
 * `src/background/analytics/gateway-analytics.ts`). Wallet addresses and
 * transactions reach Starknet RPC endpoints as the inherent function of a
 * wallet, not as collection by this extension.
 *
 * This is a public statement of data practice, so it is pinned by a test:
 * changing it is a deliberate act that needs the same review the privacy
 * policy gets, not an edit that rides along with a refactor.
 */
export const FIREFOX_DATA_COLLECTION_PERMISSIONS = {
  required: ["none"],
  optional: ["technicalAndInteraction"],
} as const;

/**
 * Longest `name` addons.mozilla.org accepts. A submission above this is
 * rejected outright, so the shipped name is checked here — where the Chrome
 * manifest gate already runs — rather than at upload time.
 */
export const FIREFOX_NAME_LIMIT = 45;

/** Background entry as it appears in both manifests. */
const BACKGROUND_SCRIPT = "background/index.js";

/** The side-panel document, reused unchanged as the Firefox sidebar panel. */
const PANEL_DOCUMENT = "sidepanel.html";

/**
 * Keys whose meaning is identical on both browsers and are copied verbatim.
 * `optional_host_permissions` (Firefox 128), the MV3 `web_accessible_resources`
 * shape (Firefox 109), and `'wasm-unsafe-eval'` in `extension_pages` (Firefox
 * 102) are all
 * supported at {@link FIREFOX_MIN_VERSION}, which is well above all three.
 */
const SHARED_KEYS = [
  "manifest_version",
  "name",
  "version",
  "description",
  "author",
  "homepage_url",
  "icons",
  "action",
  "content_scripts",
  "host_permissions",
  "optional_host_permissions",
  "options_ui",
  "web_accessible_resources",
] as const;

/**
 * Keys this transform replaces with a Gecko equivalent rather than copying.
 * Listed so the exhaustiveness check below can tell "handled" from "forgotten".
 */
const REWRITTEN_KEYS = ["background", "content_security_policy", "permissions"] as const;

/**
 * Keys intentionally absent from the Firefox manifest. `side_panel` has no Gecko
 * counterpart (`sidebar_action` is generated in its place), and `sandbox` is
 * dropped along with the page it declares — see the module comment.
 */
const CHROME_ONLY_KEYS = ["side_panel", "sandbox"] as const;

/**
 * Manifest permissions that exist only on Chrome. `sidePanel` gates the
 * `chrome.sidePanel` API; `sidebar_action` requires no permission, and an
 * unrecognised permission is a hard install error on Firefox.
 */
const CHROME_ONLY_PERMISSIONS = new Set(["sidePanel"]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, key: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) {
    throw new Error(`chrome manifest ${key} must be an object`);
  }
  return value;
};

const requireStringArray = (value: unknown, key: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`chrome manifest ${key} must be an array of strings`);
  }
  return value as readonly string[];
};

/**
 * Fails when the Chrome manifest grew a key no one has decided about. This is
 * the anti-drift guard the whole module exists for: a silently copied or
 * silently dropped key is how the two manifests would diverge in meaning while
 * still both parsing.
 */
const requireEveryKeyClassified = (chrome: Manifest): void => {
  const classified = new Set<string>([...SHARED_KEYS, ...REWRITTEN_KEYS, ...CHROME_ONLY_KEYS]);
  const unclassified = Object.keys(chrome).filter((key) => !classified.has(key));
  if (unclassified.length > 0) {
    throw new Error(
      `chrome manifest keys are unclassified for Firefox: ${unclassified.sort().join(", ")}. ` +
        "Add each to SHARED_KEYS, REWRITTEN_KEYS, or CHROME_ONLY_KEYS in apps/extension/firefox-manifest.ts.",
    );
  }
};

/**
 * The Gecko sidebar, built from the toolbar action so its title and artwork
 * have one definition. `open_at_install` is false because first run already
 * opens onboarding in a tab; a sidebar opening on top of it is noise.
 */
const sidebarAction = (chrome: Manifest): Record<string, unknown> => {
  const action = requireRecord(chrome["action"], "action");
  return {
    default_panel: PANEL_DOCUMENT,
    default_title: action["default_title"],
    default_icon: action["default_icon"],
    open_at_install: false,
  };
};

/**
 * Rewrites the background declaration as a Firefox event page. The module type
 * carries over: the bundle is ESM either way.
 */
const background = (chrome: Manifest): Record<string, unknown> => {
  const declared = requireRecord(chrome["background"], "background");
  if (declared["service_worker"] !== BACKGROUND_SCRIPT) {
    throw new Error(`chrome manifest background.service_worker must be ${BACKGROUND_SCRIPT}`);
  }
  return { scripts: [BACKGROUND_SCRIPT], type: declared["type"] };
};

/**
 * The Gecko-only developer block, which Firefox renders as a linked publisher
 * name on the add-on listing. Chrome has no equivalent key, so it is added here
 * rather than shared.
 *
 * Derived from `author` and `homepage_url` rather than restating them: an
 * extension whose package, listing and website disagree about who publishes it
 * is exactly what a store reviewer reads as impersonation, and two copies of a
 * publisher name is how that disagreement starts.
 */
const developer = (chrome: Manifest): Record<string, unknown> => {
  const name = chrome["author"];
  const url = chrome["homepage_url"];
  if (typeof name !== "string" || typeof url !== "string") {
    throw new Error("chrome manifest author and homepage_url must be strings");
  }
  return { name, url };
};

/**
 * Keeps the extension-page policy and drops the sandbox policy, which would
 * describe a page this build does not ship.
 */
const contentSecurityPolicy = (chrome: Manifest): Record<string, unknown> => {
  const declared = requireRecord(chrome["content_security_policy"], "content_security_policy");
  return { extension_pages: declared["extension_pages"] };
};

/**
 * Whether a build target ships the manifest-sandboxed collectible renderer.
 *
 * One decision behind both halves of withholding that page: the build skips
 * bundling and copying it, and {@link FIREFOX_EXCLUDED_FILES} keeps it out of
 * the packaged set. Two independent target checks would eventually disagree,
 * and the disagreement would be a page shipped without the manifest entry that
 * sandboxes it.
 */
export const shipsSandboxedRenderer = (target: string): boolean => target !== "firefox";

/**
 * Packaged files withheld from a target that {@link shipsSandboxedRenderer}
 * returns false for, as they appear in `EXPECTED_RUNTIME_FILES`.
 */
export const FIREFOX_EXCLUDED_FILES: readonly string[] = [
  "sandbox/render.html",
  "sandbox/render.js",
];

/** Drops Chrome-only permissions; an unknown permission blocks install on Firefox. */
const permissions = (chrome: Manifest): readonly string[] =>
  requireStringArray(chrome["permissions"], "permissions").filter(
    (permission) => !CHROME_ONLY_PERMISSIONS.has(permission),
  );

/**
 * Produces the Firefox manifest for a parsed Chrome manifest.
 *
 * Throws when the Chrome manifest carries a top-level key this module has not
 * classified, or when a rewritten key is not the shape the rewrite assumes. It
 * never reaches the filesystem or the network, so the build, the packaging
 * gate, and the tests all derive the same bytes from the same input.
 */
export const toFirefoxManifest = (chrome: Manifest): Record<string, unknown> => {
  requireEveryKeyClassified(chrome);
  const name = chrome["name"];
  if (typeof name !== "string" || name.length > FIREFOX_NAME_LIMIT) {
    throw new Error(
      `chrome manifest name must be at most ${FIREFOX_NAME_LIMIT} characters to be accepted by addons.mozilla.org`,
    );
  }
  const shared = Object.fromEntries(
    SHARED_KEYS.filter((key) => key in chrome).map((key) => [key, chrome[key]]),
  );
  return {
    ...shared,
    background: background(chrome),
    content_security_policy: contentSecurityPolicy(chrome),
    permissions: permissions(chrome),
    sidebar_action: sidebarAction(chrome),
    developer: developer(chrome),
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_EXTENSION_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        data_collection_permissions: FIREFOX_DATA_COLLECTION_PERMISSIONS,
      },
    },
  };
};
