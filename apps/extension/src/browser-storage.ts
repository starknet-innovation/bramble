/**
 * Browser extension storage adapter kept behind the generic key-value boundary.
 */
import type { Json } from "@bramble/core/json";
import { assertJsonValue, assertStorageKey, type KeyValueStore } from "@bramble/store/kv";
import { resolveExtensionApi } from "./extension-api";

type StorageArea = {
  readonly get: (key: string) => Promise<Record<string, unknown>>;
  readonly remove: (key: string) => Promise<void>;
  readonly set: (items: Record<string, Json>) => Promise<void>;
};

type RestrictedStorageArea = StorageArea & {
  readonly setAccessLevel?: (options: {
    readonly accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" | "TRUSTED_CONTEXTS";
  }) => Promise<void>;
};

type StorageGlobal = {
  readonly storage?: {
    readonly local?: RestrictedStorageArea;
    readonly session?: RestrictedStorageArea;
    readonly sync?: RestrictedStorageArea;
  };
};

const storageAreas = (): StorageGlobal["storage"] => resolveExtensionApi<StorageGlobal>()?.storage;

const createAreaStore = (storage: StorageArea): KeyValueStore => ({
  async get(key) {
    assertStorageKey(key);
    return (await storage.get(key))[key];
  },
  async remove(key) {
    assertStorageKey(key);
    await storage.remove(key);
  },
  async set(key, value) {
    assertStorageKey(key);
    assertJsonValue(value);
    await storage.set({ [key]: value });
  },
});

/**
 * Creates the only production adapter for chrome.storage.local access.
 */
export const createBrowserLocalStore = (): KeyValueStore => {
  const storage = storageAreas()?.local;

  if (!storage) {
    throw new Error("browser storage.local is unavailable");
  }

  return createAreaStore(storage);
};

/**
 * Creates the only production adapter for chrome.storage.session access.
 * Session storage lives in memory, survives service-worker restarts, and is
 * cleared when the browser exits.
 */
export const createBrowserSessionStore = (): KeyValueStore => {
  const storage = storageAreas()?.session;

  if (!storage) {
    throw new Error("browser storage.session is unavailable");
  }

  return createAreaStore(storage);
};

/**
 * Creates the production adapter for sync-backed vault freshness markers. The
 * encrypted vault itself remains local; this independent area only stores
 * non-secret lineage and commit capabilities used to reject local rollback.
 */
export const createBrowserSyncStore = (): KeyValueStore => {
  const storage = storageAreas()?.sync;
  if (!storage) {
    throw new Error("browser storage.sync is unavailable");
  }
  return createAreaStore(storage);
};

const restrictToTrustedContexts = async (
  storage: RestrictedStorageArea | undefined,
): Promise<boolean> => {
  if (!storage?.setAccessLevel) {
    return false;
  }
  await storage.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  return true;
};

/**
 * Restricts persistent wallet storage to extension-owned contexts. Chrome
 * exposes `storage.local` to content scripts by default; the background owns
 * every persistence adapter, so content scripts need no direct access.
 */
export const hardenLocalAccess = async (): Promise<boolean> =>
  restrictToTrustedContexts(storageAreas()?.local);

/**
 * Restricts the in-memory session area to trusted extension contexts
 * (background, popup, side panel) so untrusted content scripts and web pages
 * can never read it. The unlock secret is mirrored there to survive
 * service-worker restarts, so this access level is what keeps it off the page's
 * reach — set explicitly rather than relying on the browser default. Resolves
 * to whether the lockdown was applied.
 */
export const hardenSessionAccess = async (): Promise<boolean> => {
  const storage = storageAreas()?.session;
  return restrictToTrustedContexts(storage);
};

/**
 * Restricts the independent vault-freshness authority to trusted extension
 * contexts so content scripts cannot advance or erase commit markers.
 */
export const hardenSyncAccess = async (): Promise<boolean> =>
  restrictToTrustedContexts(storageAreas()?.sync);

/**
 * The build this bundle was produced for, stamped by `apps/extension/build.ts`.
 * Absent in tests and in any unstamped bundle, where the strict Chromium rule
 * below is the safe reading.
 */
declare const __MC_BUILD_TARGET__: string | undefined;

/**
 * The build this bundle was produced for, or undefined when it is unstamped
 * (tests, and any bundle the build script did not stamp). Callers compare it
 * against an exact target and treat anything else as the safe Chromium shape.
 */
export const buildTarget = (): string | undefined =>
  typeof __MC_BUILD_TARGET__ === "string" ? __MC_BUILD_TARGET__ : undefined;

/**
 * Whether a failed storage lockdown is fatal.
 *
 * Chromium implements `storage.setAccessLevel`, so on that target a lockdown
 * that does not apply means the browser is not behaving as this wallet's threat
 * model assumes, and startup must stop.
 *
 * Firefox implements no `setAccessLevel` on any area (bugzil.la/1724754), so
 * there the call cannot be made at all and refusing to start would only mean
 * refusing to run on Firefox. What survives there is the platform default
 * rather than an asserted one, and the two halves differ:
 *
 * - `storage.session` is unreachable from content scripts by default on every
 *   browser, so the mirrored unlock capability keeps its guarantee — this call
 *   was confirming that default, not creating it.
 * - `storage.local` and `storage.sync` ARE reachable from this extension's own
 *   content script on Firefox and cannot be closed off. That exposes the
 *   encrypted vault blob and the freshness markers to a compromised content
 *   script: ciphertext they still cannot read without the credential that
 *   unlocks it, and rollback markers they could tamper with. This is a genuinely weaker
 *   position than the Chromium build holds, it is not reachable from page
 *   script, and it is the price of a Firefox build existing at all.
 *
 * Only the exact target "firefox" relaxes this. Anything else — an unstamped
 * bundle, a target this predicate has never heard of — keeps the strict rule,
 * so a build that loses or garbles its stamp fails closed rather than quietly
 * adopting the weaker posture.
 */
export const lockdownIsEnforceable = (target: string | undefined): boolean => target !== "firefox";

const LOCKDOWN_IS_ENFORCEABLE = lockdownIsEnforceable(buildTarget());

/**
 * Requires all wallet storage areas to be unavailable to untrusted extension
 * contexts before privileged startup may continue. Local holds ciphertext,
 * session may hold the live unlock capability, and sync owns freshness state.
 *
 * The lockdown is always attempted, on every target, so a browser that gains
 * `setAccessLevel` is used the moment it has it. Whether a failure is fatal is
 * decided by {@link lockdownIsEnforceable}; on the Chromium build it is.
 *
 * `enforceable` defaults to this bundle's own answer and production passes
 * nothing. It is a parameter at all because the value is inlined by the
 * bundler, which left the branch that consumes it unreachable from a test —
 * removing the check entirely broke no test until this existed.
 */
export const requireTrustedStorageAccess = async (
  enforceable: boolean = LOCKDOWN_IS_ENFORCEABLE,
): Promise<void> => {
  const [localRestricted, sessionRestricted, syncRestricted] = await Promise.all([
    hardenLocalAccess(),
    hardenSessionAccess(),
    hardenSyncAccess(),
  ]);
  if (enforceable && (!localRestricted || !sessionRestricted || !syncRestricted)) {
    throw new Error("trusted browser storage access is unavailable");
  }
};
