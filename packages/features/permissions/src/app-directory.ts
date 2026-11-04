/**
 * The app directory (mc-wallet issue 749): Starknet apps SNF has reviewed and
 * listed by hand, bundled with the extension and changed only through a
 * reviewed PR and a release. It adds no network traffic.
 *
 * Pure module. The bundled entries live in ./app-directory-data; this file
 * owns their shape, the rules every entry must pass (a test runs them over the
 * bundled data, so a malformed entry fails CI), and the lookups the wallet
 * makes. An origin is matched exactly, scheme, host and port, never as a
 * suffix or a lookalike, so `https://app.example.xyz.evil.io` is not listed
 * because `https://app.example.xyz` is.
 */
import {
  canonicalFelt,
  isNonZeroStarkFieldElement,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import { LISTED_APPS, REVOKED_APPS } from "./app-directory-data";
import {
  APP_CATEGORIES,
  APP_DIRECTORY_NETWORKS,
  type ListedApp,
  MAX_APP_NAME_LENGTH,
} from "./app-directory-types";

/** The directory's entry shape, re-exported for the package entry point. */
export type { AppCategory, ListedApp } from "./app-directory-types";
/** The directory's categories, networks and name cap. */
export { APP_CATEGORIES, APP_DIRECTORY_NETWORKS, MAX_APP_NAME_LENGTH } from "./app-directory-types";

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The canonical spelling of an exact https origin, or null for anything else:
 * another scheme, a path, a query, a fragment, credentials, or a string the
 * URL parser rejects. Listing data must already be in this spelling.
 */
export const exactHttpsOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
    if (value.endsWith("/")) return null;
    // The browser's own origin spelling (lowercase, punycode, no default
    // port). A trailing-dot host is a different origin to the browser, so it
    // is never folded into the listed one.
    const host = url.hostname;
    if (host === "" || host.includes("*") || host.endsWith(".")) return null;
    return url.origin;
  } catch {
    return null;
  }
};

const isAuditLink = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
};

const isCanonicalContract = (value: string): boolean =>
  isNonZeroStarkFieldElement(value) && canonicalFelt(value) === value;

// The problems with one network's declared contracts.
const networkErrors = (at: string, network: string, app: ListedApp): readonly string[] => {
  if (!(APP_DIRECTORY_NETWORKS as readonly string[]).includes(network)) {
    return [`${at} unknown network ${network}`];
  }
  const contracts = app.chains[network as keyof ListedApp["chains"]]?.contracts ?? [];
  return [
    ...(contracts.length === 0 ? [`${at} ${network} declares no contract`] : []),
    ...(new Set(contracts).size === contracts.length
      ? []
      : [`${at} ${network} repeats a contract`]),
    ...contracts
      .filter((contract) => !isCanonicalContract(contract))
      .map((contract) => `${at} ${network} contract ${contract} is not a canonical non-zero felt`),
  ];
};

const isListedName = (name: string): boolean =>
  name.trim() === name && name.length > 0 && name.length <= MAX_APP_NAME_LENGTH;

const entryErrors = (app: ListedApp): readonly string[] => {
  const at = `${app.id || "(no id)"}:`;
  const networks = Object.keys(app.chains);
  const checks: ReadonlyArray<readonly [boolean, string]> = [
    [ID.test(app.id), "id must be a lowercase slug"],
    [
      isListedName(app.name),
      `name must be 1-${MAX_APP_NAME_LENGTH} characters with no outer spaces`,
    ],
    [
      exactHttpsOrigin(app.origin) === app.origin,
      "origin must be an exact https origin in canonical spelling",
    ],
    [APP_CATEGORIES.includes(app.category), "unknown category"],
    [isAuditLink(app.audit), "audit must be an https link"],
    [networks.length > 0, "declares no network"],
  ];
  return [
    ...checks.filter(([ok]) => !ok).map(([, message]) => `${at} ${message}`),
    ...networks.flatMap((network) => networkErrors(at, network, app)),
  ];
};

/**
 * Every rule the directory breaks, empty when it is valid: malformed entries,
 * a repeated id or origin, and a revoked origin that is not an exact https
 * origin or is still listed.
 */
export const appDirectoryErrors = (
  apps: readonly ListedApp[],
  revoked: readonly string[],
): readonly string[] => {
  const errors = apps.flatMap(entryErrors);
  const ids = apps.map((app) => app.id);
  const origins = apps.map((app) => app.origin);
  for (const id of new Set(ids)) {
    if (ids.filter((other) => other === id).length > 1) errors.push(`duplicate id ${id}`);
  }
  for (const origin of new Set(origins)) {
    if (origins.filter((other) => other === origin).length > 1) {
      errors.push(`duplicate origin ${origin}`);
    }
  }
  for (const origin of revoked) {
    if (exactHttpsOrigin(origin) !== origin)
      errors.push(`revoked ${origin} is not an exact https origin`);
    if (origins.includes(origin)) errors.push(`revoked ${origin} is still listed`);
  }
  if (new Set(revoked).size !== revoked.length) errors.push("a revoked origin is repeated");
  return errors;
};

/** The directory's lookups. */
export type AppDirectory = {
  /** Listed apps that declare contracts on `networkId`, by name. */
  readonly appsFor: (networkId: StarknetNetworkId) => readonly ListedApp[];
  /** The listing for exactly this origin, or undefined. */
  readonly listing: (origin: string) => ListedApp | undefined;
  /** Whether this exact origin was delisted. */
  readonly revoked: (origin: string) => boolean;
  /**
   * The called contracts the origin's listing does not declare on
   * `networkId`, canonical and de-duplicated. Empty for an unlisted origin:
   * the flag is about a listed app stepping outside its own listing.
   */
  readonly undeclaredContracts: (
    origin: string,
    networkId: StarknetNetworkId,
    contracts: readonly string[],
  ) => readonly string[];
};

// A sender origin as the browser reports it, spelled as listings are. Only an
// exact https origin has a key: credentials, a path or a trailing-dot host
// never reach a listing.
const lookupKey = (origin: string): string | null => exactHttpsOrigin(origin);

/**
 * Builds the lookups over a directory. Data that breaks any rule lists
 * nothing, so a bad entry is never half-trusted, while every well-formed
 * revoked origin is still warned about: a broken listing must not silence a
 * delisting. The test suite runs the same rules over the bundled data, so such
 * data fails CI before it can ship.
 */
export const createAppDirectory = (
  listedApps: readonly ListedApp[],
  revokedOrigins: readonly string[],
): AppDirectory => {
  const valid = appDirectoryErrors(listedApps, revokedOrigins).length === 0;
  const apps = valid ? listedApps : [];
  const revoked = valid
    ? revokedOrigins
    : revokedOrigins.filter((origin) => exactHttpsOrigin(origin) === origin);
  const byOrigin = new Map(apps.map((app) => [app.origin, app]));
  const revokedSet = new Set(revoked);
  const listing = (origin: string): ListedApp | undefined => {
    const key = lookupKey(origin);
    return key === null ? undefined : byOrigin.get(key);
  };
  return {
    appsFor: (networkId) =>
      apps
        .filter(
          (app) => (app.chains[networkId as keyof ListedApp["chains"]]?.contracts.length ?? 0) > 0,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    listing,
    revoked: (origin) => {
      const key = lookupKey(origin);
      return key !== null && revokedSet.has(key);
    },
    undeclaredContracts: (origin, networkId, contracts) => {
      const app = listing(origin);
      if (!app) return [];
      const declared = new Set(app.chains[networkId as keyof ListedApp["chains"]]?.contracts ?? []);
      const called = contracts.map((contract) => canonicalFelt(contract) ?? contract);
      return [...new Set(called)].filter((contract) => !declared.has(contract));
    },
  };
};

/** The bundled directory. */
export const APP_DIRECTORY: AppDirectory = createAppDirectory(LISTED_APPS, REVOKED_APPS);
