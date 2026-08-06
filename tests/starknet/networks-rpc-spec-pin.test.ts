/**
 * The RPC spec version is pinned in two places that must not drift apart: the
 * `v0_10` path segment on every Foundation-operated endpoint (the wallet
 * gateway and the direct-node fallbacks behind it), and the `specVersion`
 * option `createRpcProvider` hands starknet.js. If only one of them is bumped
 * the wallet silently encodes requests for one spec while an endpoint serves
 * another, and the version-dependent paths (`PRE_CONFIRMED` finality,
 * `proof`/`proofFacts` invoke fields) fail quietly rather than loudly.
 */
import { expect, test } from "bun:test";

import { STARKNET_NETWORKS, STARKNET_RPC_SPEC_VERSION } from "../../src/starknet/networks";
import { createRpcProvider } from "../../src/starknet/provider";

// Every endpoint the Starknet Foundation runs for this wallet — the gateway and
// the nodes it forwards to — is version-pinned by path. Third-party and local
// endpoints are not ours to pin.
const FOUNDATION_HOST_SUFFIX = ".nodes.starknet.org";

// "0.10.0" -> "v0_10": the pin fixes the spec's minor family, not its patch.
const gatewayPathSegment = (specVersion: string): string => {
  const [major, minor] = specVersion.split(".");
  return `v${major}_${minor}`;
};

const allRpcUrls = (): readonly string[] =>
  Object.values(STARKNET_NETWORKS).flatMap((network) => [...network.rpcUrls]);

const isFoundationUrl = (url: string): boolean =>
  new URL(url).hostname.endsWith(FOUNDATION_HOST_SUFFIX);

test("pins every Foundation-operated RPC URL to the reviewed spec version", () => {
  const pinned = allRpcUrls().filter(isFoundationUrl);
  // Guards the guard: a renamed host would otherwise vacuously pass.
  expect(pinned.length).toBeGreaterThan(0);
  for (const url of pinned) {
    expect(url.endsWith(`/${gatewayPathSegment(STARKNET_RPC_SPEC_VERSION)}`)).toBe(true);
  }
});

test("keeps the provider's channel in step with the pinned path segment", () => {
  // `specVersion` is private on the channel, so this asserts the observable
  // consequence instead: the pin must select starknet.js's channel for the same
  // spec family the pinned URLs are routed to.
  const provider = createRpcProvider("https://rpc.invalid");
  expect(gatewayPathSegment(provider.channel.channelSpecVersion)).toBe(
    gatewayPathSegment(STARKNET_RPC_SPEC_VERSION),
  );
});

test("leaves only non-Foundation endpoints unpinned", () => {
  // Cartridge and local devnet run whatever spec their operator chose; the
  // wallet cannot pin their routing, so only the provider-side encoding pin
  // applies. Listed explicitly so adding an unpinned endpoint is a deliberate,
  // reviewed act rather than a silent one.
  expect(allRpcUrls().filter((url) => !isFoundationUrl(url))).toEqual([
    "https://api.cartridge.gg/x/starknet/sepolia",
    "http://127.0.0.1:5050/rpc",
  ]);
});

test("prefers the wallet gateway over the direct-node fallback on every network", () => {
  // Ordering is the whole point of the fallback: the gateway carries the rate
  // limiting and observability, so it must stay the first entry tried.
  for (const network of [STARKNET_NETWORKS.SN_MAIN, STARKNET_NETWORKS.SN_SEPOLIA]) {
    expect(network.rpcUrls[0].startsWith("https://wallet.nodes.starknet.org/")).toBe(true);
    expect(network.rpcUrls.length).toBeGreaterThan(1);
  }
});
