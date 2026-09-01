/**
 * The RPC spec version is pinned in two places that must not drift apart: the
 * `v0_10` path segment on every bundled `.nodes.starknet.org` endpoint (the
 * wallet-operated gateway and Foundation direct-node fallbacks), and the
 * `specVersion` option `createRpcProvider` hands starknet.js. If only one of
 * them is bumped the wallet silently encodes requests for one spec while an
 * endpoint serves another, and the version-dependent paths (`PRE_CONFIRMED`
 * finality, `proof`/`proofFacts` invoke fields) fail quietly rather than loudly.
 */
import { expect, test } from "bun:test";
import { createRpcProvider } from "@bramble/starknet/provider";
import { STARKNET_NETWORKS, STARKNET_RPC_SPEC_VERSION } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";

// The wallet gateway and Foundation fallback nodes share this domain. Third-
// party and local endpoints are deliberately excluded from path pinning.
const NODES_STARKNET_ORG_SUFFIX = ".nodes.starknet.org";

// "0.10.0" -> "v0_10": the pin fixes the spec's minor family, not its patch.
const gatewayPathSegment = (specVersion: string): string => {
  const [major, minor] = specVersion.split(".");
  return `v${major}_${minor}`;
};

const allRpcUrls = (): readonly string[] =>
  Object.values(STARKNET_NETWORKS).flatMap((network) => [...network.rpcUrls]);

const isNodesStarknetOrgUrl = (url: string): boolean =>
  new URL(url).hostname.endsWith(NODES_STARKNET_ORG_SUFFIX);

test("pins every bundled gateway and Foundation RPC URL to the reviewed spec version", () => {
  const pinned = allRpcUrls().filter(isNodesStarknetOrgUrl);
  // Guards the guard: a renamed host would otherwise vacuously pass.
  expect(pinned.length).toBeGreaterThan(0);
  for (const url of pinned) {
    expect(url.endsWith(`/${gatewayPathSegment(STARKNET_RPC_SPEC_VERSION)}`)).toBe(true);
  }
});

test("passes the reviewed spec pin directly to the RPC provider", () => {
  let capturedProviderOptions: unknown;

  createRpcProvider("https://rpc.invalid", {}, (options) => {
    capturedProviderOptions = options;
    return {} as RpcProvider;
  });

  // The bounded transport is asserted separately in rpc-provider-timeout.test.ts
  // (MCW-V09-121); here it is only required to be present alongside the pin.
  expect(capturedProviderOptions).toMatchObject({
    nodeUrl: "https://rpc.invalid",
    specVersion: STARKNET_RPC_SPEC_VERSION,
  });
  expect(Object.keys(capturedProviderOptions as object).sort()).toEqual([
    "baseFetch",
    "nodeUrl",
    "specVersion",
  ]);
});

test("leaves only third-party and local endpoints unpinned", () => {
  // Cartridge and local devnet run whatever spec their operator chose; the
  // wallet cannot pin their routing, so only the provider-side encoding pin
  // applies. Listed explicitly so adding an unpinned endpoint is a deliberate,
  // reviewed act rather than a silent one.
  expect(allRpcUrls().filter((url) => !isNodesStarknetOrgUrl(url))).toEqual([
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
