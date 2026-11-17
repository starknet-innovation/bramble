/**
 * Resolves the effective value of every known flag from the bundled catalog,
 * an optional verified payload, and local targeting context.
 *
 * Pure and total: the catalog defines the output keys, so a remote document can
 * neither add a flag nor remove one, and a missing document yields exactly the
 * bundled defaults. Targeting inputs (install bucket, version, chain) stay on
 * the device; nothing here is sent anywhere.
 */
import type { FlagCatalog } from "./catalog";
import {
  compareFlagVersions,
  type FlagPayload,
  type FlagRule,
  isFlagVersion,
  MAX_ROLLOUT,
} from "./contract";

/** Local targeting inputs. Never leave the device. */
export type FlagTargeting = {
  /** Per-install random integer in [0, 9999]. */
  readonly bucket: number;
  /** Active chain id (`SN_MAIN`, `SN_SEPOLIA`, ...), or null when unknown. */
  readonly chain: string | null;
  /** This build's `x.y.z` manifest version, or null when unreadable. */
  readonly version: string | null;
};

/** Effective boolean per known flag. */
export type FlagValues = Readonly<Record<string, boolean>>;

// FNV-1a over the key's UTF-16 code units. Offsets the install bucket per flag
// so two flags at the same rollout percentage do not always pick the same
// installs, while each flag's cohort stays stable across refreshes.
const flagOffset = (key: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % MAX_ROLLOUT;
};

/** The install's rollout position for one flag, in [0, 9999]. */
export const flagBucket = (key: string, bucket: number): number =>
  (bucket + flagOffset(key)) % MAX_ROLLOUT;

const versionMatches = (rule: FlagRule, version: string | null): boolean => {
  if (rule.minVersion === undefined && rule.maxVersion === undefined) {
    return true;
  }
  if (!isFlagVersion(version)) {
    return false;
  }
  return (
    (rule.minVersion === undefined || compareFlagVersions(version, rule.minVersion) >= 0) &&
    (rule.maxVersion === undefined || compareFlagVersions(version, rule.maxVersion) <= 0)
  );
};

/** Whether a remote rule turns its flag on for this install. */
const ruleOn = (key: string, rule: FlagRule, targeting: FlagTargeting): boolean =>
  rule.enabled &&
  (rule.rollout === undefined || flagBucket(key, targeting.bucket) < rule.rollout) &&
  versionMatches(rule, targeting.version) &&
  (rule.chains === undefined ||
    (targeting.chain !== null && (rule.chains as readonly string[]).includes(targeting.chain)));

/**
 * Evaluates every catalog flag. A flag without a remote rule keeps its bundled
 * default; `kill-only` flags can only be lowered (`default && remote`);
 * `toggle` flags take the remote decision.
 */
export const evaluateFlags = (
  catalog: FlagCatalog,
  payload: FlagPayload | null,
  targeting: FlagTargeting,
): FlagValues => {
  const values: Record<string, boolean> = {};
  for (const [key, known] of Object.entries(catalog)) {
    const rule = payload && Object.hasOwn(payload.flags, key) ? payload.flags[key] : undefined;
    if (rule === undefined) {
      values[key] = known.enabled;
      continue;
    }
    const remote = ruleOn(key, rule, targeting);
    values[key] = (known.remote ?? "kill-only") === "toggle" ? remote : known.enabled && remote;
  }
  return values;
};
