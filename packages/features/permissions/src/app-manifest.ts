/**
 * The domain manifest check behind app directory admission (mc-wallet issue
 * 749). An applicant serves `/.well-known/starknet-app.json` from its own
 * https origin, which proves it controls the domain, and the manifest must
 * declare the same name, networks and contracts as its directory entry.
 *
 * Pure: the dev-only `scripts/check-app-manifest.ts` fetches the manifest and
 * calls this. The extension never fetches a manifest.
 */
import { hasOnlyKnownKeys, isRecord } from "@bramble/core/json";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import { APP_DIRECTORY_NETWORKS, type ListedApp } from "./app-directory-types";

/** Where an app serves its manifest, relative to its origin. */
export const APP_MANIFEST_PATH = "/.well-known/starknet-app.json";

const contractSet = (value: unknown): ReadonlySet<string> | null => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return null;
  const canonical = value.map((item: string) => canonicalFelt(item));
  return canonical.every((item) => item !== null) ? new Set(canonical as string[]) : null;
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((item) => b.has(item));

// The contract mismatches on each network both sides declare.
const contractErrors = (app: ListedApp, chains: Readonly<Record<string, unknown>>): string[] =>
  APP_DIRECTORY_NETWORKS.flatMap((network) => {
    const listed = app.chains[network]?.contracts;
    const entry = chains[network];
    if (listed === undefined || entry === undefined) return [];
    const served =
      isRecord(entry) && hasOnlyKnownKeys(entry, ["contracts"])
        ? contractSet(entry["contracts"])
        : null;
    if (served === null) return [`${network} contracts must be a list of felts`];
    return sameSet(served, new Set(listed)) ? [] : [`${network} contracts differ from the listing`];
  });

/**
 * Every way the served manifest disagrees with the listing, empty when they
 * match. Anything that is not the expected JSON shape is a mismatch, never
 * skipped: an applicant cannot pass by serving something the check ignores.
 */
export const appManifestMismatches = (app: ListedApp, manifest: unknown): readonly string[] => {
  if (!isRecord(manifest) || !hasOnlyKnownKeys(manifest, ["chains", "name"])) {
    return ["manifest must be an object with only name and chains"];
  }
  const errors: string[] =
    manifest["name"] === app.name
      ? []
      : [`name is ${JSON.stringify(manifest["name"])}, listed as ${JSON.stringify(app.name)}`];
  const chains = manifest["chains"];
  if (!isRecord(chains)) return [...errors, "chains must be an object"];
  // Compared as sets of keys, never as joined text: a key that merely spells
  // the listed set ("SN_MAIN, SN_SEPOLIA") is not those networks.
  const served = Object.keys(chains).sort();
  const listed = Object.keys(app.chains).sort();
  if (
    served.length !== listed.length ||
    served.some((network, index) => network !== listed[index])
  ) {
    errors.push(`networks are ${served.join(", ") || "none"}, listed as ${listed.join(", ")}`);
  }
  return [...errors, ...contractErrors(app, chains)];
};
