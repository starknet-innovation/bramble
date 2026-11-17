/**
 * What this build knows about feature flags: every flag it can read, its
 * bundled default, how far a remote document may move it, the publisher keys it
 * trusts, and where it fetches from. All of it ships in the extension bundle.
 *
 * Remote documents can only affect flags declared here; unknown remote keys
 * are ignored. Flags toggle code that already ships — they never gate or alter
 * signing, key derivation, RPC endpoints, contract addresses, fee ceilings,
 * permission checks, or privacy-pool parameters
 * (`tests/conformance/feature-flag-isolation.test.ts` enforces the import side
 * of that rule).
 */
import type { FlagChannel } from "./contract";

/**
 * How a remote document may move a known flag.
 *
 * - `kill-only`: remote may turn the flag off, never on beyond its bundled
 *   default. The default for every flag.
 * - `toggle`: remote decides, within its targeting rules. Reserve for flags
 *   whose "on" path has shipped and been reviewed in this build.
 */
export type FlagRemoteMode = "kill-only" | "toggle";

/** A flag this build knows. */
export type KnownFlag = {
  readonly enabled: boolean;
  /**
   * Whether an advanced user may override this flag locally (Settings >
   * Experimental features). Defaults to false. A remote hard kill still wins.
   */
  readonly localOverride?: boolean;
  readonly remote?: FlagRemoteMode;
};

/** Every flag this build can read, keyed by its bramble-ff key. */
export type FlagCatalog = Readonly<Record<string, KnownFlag>>;

/**
 * Bundled defaults. `swap.enabled` mirrors the in-wallet swap that ships
 * today, so the publisher can kill it but never resurrect it past this build.
 *
 * `qsb.vaults` shows the QSB vault entry points (the drawer row, the
 * onboarding choices and the `qsb-*` screens). It ships off, and only a
 * verified bramble-ff rule turns it on, which allows a staged rollout.
 * Testers may also turn it on for their own device in Settings >
 * Experimental features (`localOverride`); a remote hard kill still wins. It
 * hides UI only: the background QSB handlers are unchanged by it.
 */
export const BUNDLED_FLAGS: FlagCatalog = {
  "qsb.vaults": { enabled: false, localOverride: true, remote: "toggle" },
  "swap.enabled": { enabled: true, remote: "kill-only" },
};

/**
 * The reviewed exceptions to `kill-only`. Each ships off, so a missing,
 * invalid or expired document leaves it hidden.
 */
export const TOGGLE_FLAGS: readonly string[] = ["qsb.vaults"];

/** The publisher channel this build accepts documents for. */
export const FEATURE_FLAG_CHANNEL: FlagChannel = "production";

/**
 * Flags CDN origin: the bramble-ff R2 custom domain. Read through CORS (the
 * CDN answers `Access-Control-Allow-Origin: *`), so no `host_permissions`
 * entry is needed or wanted (issue 772).
 */
export const FEATURE_FLAG_ORIGIN = "https://flags.bramble.fi";

/** The one document URL this build fetches: fixed path, no query string. */
export const FEATURE_FLAG_URL = `${FEATURE_FLAG_ORIGIN}/v1/${FEATURE_FLAG_CHANNEL}.json`;

/**
 * Trusted Ed25519 public keys (base64url raw 32 bytes) by keyId. Must match
 * `keys/public-keys.json` in bramble-ff. Rotate per its README: add the new
 * key in one release, drop the old one in a later release.
 */
export const TRUSTED_FLAG_KEYS: Readonly<Record<string, string>> = {
  "flags-2026-11": "csWr6YeIUsfNZ6XqC18YIG9wpkcMYNMLkdhUqrP0Az8",
};
