/**
 * Stored endpoints written by an earlier build, brought to their canonical
 * spelling before the preferences validator runs.
 *
 * Up to this build an endpoint was stored as entered, so long as the URL parser
 * accepted it. The parser accepts spellings it only fixes when it serializes,
 * such as backslashes, a space or a `<` it percent-encodes, or a tab it drops.
 * An error echoing one could leave part of an API key outside a redaction.
 * `isServiceUrl` now requires the canonical spelling, so an old record would
 * fail the whole read with `Invalid stored preferences`. Each endpoint is
 * rewritten to the parser's serialization instead, which is the request it
 * already made.
 */
import { isRecord } from "@bramble/core/json";
import {
  normalizeStoredServiceUrl,
  normalizeStoredWebSocketServiceUrl,
} from "@bramble/core/service-url";
import { isStrk20NetworkConfig } from "@bramble/privacy/config";
import { isStarknetNetworkId } from "@bramble/wallet-model/networks";

// Returns the carried value, or `undefined` to drop it (see
// normalizeStoredServiceUrl); anything this build cannot read comes back as is.
type Carry = (value: unknown) => unknown;

// A network-keyed map. A dropped endpoint leaves its network unset, which
// selects the built-in endpoint or, for STRK20 routing, disables the network.
// Only an entry under a network id is dropped: under any other key the value
// stays, so the validator still rejects the key rather than see it vanish.
// Rebuilt with `Object.fromEntries`, which defines own properties, so a key such
// as `__proto__` survives for the validator to reject too.
const carryMap = (map: unknown, carry: Carry): unknown => {
  if (!isRecord(map)) {
    return map;
  }
  const entries = Object.keys(map).map((key) => {
    const carried = carry(map[key]);
    const kept = carried === undefined && !isStarknetNetworkId(key) ? map[key] : carried;
    return [key, map[key], kept] as const;
  });
  if (entries.every(([, value, carried]) => carried === value)) {
    return map;
  }
  return Object.fromEntries(
    entries.flatMap(([key, , carried]) => (carried === undefined ? [] : [[key, carried]])),
  );
};

// A network whose RPC override was dropped falls back to the built-in RPCs,
// where the explorer-fallback default is on (`explorerFallbackAllowed`). With
// the override that default was off, so it is pinned off: dropping an endpoint
// must not switch on a third-party address disclosure the user never allowed.
const pinnedFallback = (before: unknown, after: unknown, fallback: unknown): unknown => {
  if (!isRecord(before) || !isRecord(after) || !(fallback === undefined || isRecord(fallback))) {
    return fallback;
  }
  const unset = Object.keys(before).filter(
    (network) => !Object.hasOwn(after, network) && fallback?.[network] === undefined,
  );
  return unset.length === 0
    ? fallback
    : { ...fallback, ...Object.fromEntries(unset.map((network) => [network, false])) };
};

const STRK20_ENDPOINT_FIELDS = ["discoveryUrl", "ohttpRelayUrl", "proverUrl"];

// Stands in for an endpoint that cannot be carried while the rest of its
// configuration is checked. It is canonical, so only another defect fails.
const DROPPED_ENDPOINT = "https://dropped.invalid";

// A STRK20 configuration whose endpoint cannot be carried is dropped whole,
// which disables privacy on that network until the user enters services again.
// Falling back to the bundled routing instead would send private traffic to
// services the user did not choose. It is dropped only when nothing else in it
// is invalid; otherwise it stays as stored, so the drop never hides a defect
// from the validator.
const carryStrk20Config = (config: unknown): unknown => {
  if (!isRecord(config)) {
    return config;
  }
  let dropped = false;
  const carryField = (record: Record<string, unknown>, field: string) => {
    if (record[field] === undefined) {
      return record;
    }
    const carried = normalizeStoredServiceUrl(record[field]);
    dropped ||= carried === undefined;
    // Only a drop takes the stand-in: a `null` comes back as is, for the
    // validator to reject (#674 review).
    const value = carried === undefined ? DROPPED_ENDPOINT : carried;
    return value === record[field] ? record : { ...record, [field]: value };
  };
  let next: Record<string, unknown> = config;
  for (const field of STRK20_ENDPOINT_FIELDS) {
    next = carryField(next, field);
  }
  const paymaster = next["paymaster"];
  if (isRecord(paymaster)) {
    const carried = carryField(paymaster, "url");
    next = carried === paymaster ? next : { ...next, paymaster: carried };
  }
  if (!dropped) {
    return next;
  }
  return isStrk20NetworkConfig(next) ? undefined : config;
};

// A custom network keeps at most its first RPC URL once compacted; an RPC URL
// that cannot be carried is removed, and the network stays listed by chain id.
const carryCustomNetwork = (network: unknown): unknown => {
  if (!isRecord(network) || !Array.isArray(network["rpcUrls"])) {
    return network;
  }
  const rpcUrls: readonly unknown[] = network["rpcUrls"];
  const carried = rpcUrls.map((url) => normalizeStoredServiceUrl(url));
  if (carried.every((url, index) => url === rpcUrls[index])) {
    return network;
  }
  const kept = [...new Set(carried.filter((url) => url !== undefined))];
  if (kept.length > 0) {
    return { ...network, rpcUrls: kept };
  }
  const { rpcUrls: _dropped, ...rest } = network;
  return rest;
};

const carryCustomNetworks = (networks: unknown): unknown => {
  if (!Array.isArray(networks)) {
    return networks;
  }
  const carried = networks.map(carryCustomNetwork);
  return carried.some((network, index) => network !== networks[index]) ? carried : networks;
};

// Every endpoint field of a stored record, with the carry for its scheme.
const ENDPOINT_FIELDS: ReadonlyArray<readonly [string, Carry]> = [
  ["customNetworks", carryCustomNetworks],
  ["explorerApiUrls", (map) => carryMap(map, normalizeStoredServiceUrl)],
  ["nftIndexerUrl", normalizeStoredServiceUrl],
  ["nostrRelayUrl", normalizeStoredWebSocketServiceUrl],
  ["rpcOverrides", (map) => carryMap(map, normalizeStoredServiceUrl)],
  ["strk20Networks", (map) => carryMap(map, carryStrk20Config)],
  ["strk20ProverUrl", normalizeStoredServiceUrl],
];

/**
 * Returns a stored preferences record with every endpoint in its canonical
 * spelling, or the same reference when nothing changes. An endpoint is dropped
 * only when an earlier build's rule accepted it but it has no canonical
 * spelling; a dropped single endpoint falls back to the built-in one, with the
 * explorer fallback kept off for a network that loses its RPC override.
 * Deterministic and total: a field this build cannot read is left as is for
 * `isWalletPreferences` to reject, so this never widens what validates.
 * Preferences hold no secret material, and nothing here logs a value.
 */
export const withCanonicalEndpoints = (
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  let next: Record<string, unknown> | undefined;
  for (const [field, carry] of ENDPOINT_FIELDS) {
    if (record[field] === undefined) {
      continue;
    }
    const carried = carry(record[field]);
    if (carried === record[field]) {
      continue;
    }
    next ??= { ...record };
    if (carried === undefined) {
      delete next[field];
    } else {
      next[field] = carried;
    }
  }
  if (next === undefined) {
    return record;
  }
  const fallback = pinnedFallback(
    record["rpcOverrides"],
    next["rpcOverrides"],
    record["explorerFallback"],
  );
  return fallback === record["explorerFallback"] ? next : { ...next, explorerFallback: fallback };
};
