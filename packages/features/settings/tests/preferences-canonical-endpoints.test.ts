/**
 * Every endpoint in preferences is held in its canonical spelling
 * (`isServiceUrl`), so `redactEndpoints` always removes it whole.
 *
 * Each settings write refuses a raw spelling the URL parser would rewrite: a
 * space, quote, angle bracket or backtick it percent-encodes, which could leave
 * part of an API key visible in a redacted error, and a backslash, a missing or
 * extra slash, or a tab it drops. A record an earlier build stored as entered
 * is carried to the canonical spelling on read rather than failing with
 * "Invalid stored preferences". The next write then persists that spelling.
 */
import { describe, expect, test } from "bun:test";
import type { Json } from "@bramble/core/json";
import { isServiceUrl } from "@bramble/core/service-url";
import { DEFAULT_STRK20_NETWORKS, isStrk20NetworkConfigs } from "@bramble/privacy/config";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";

const NBSP = String.fromCharCode(0xa0);
const IDEOGRAPHIC = String.fromCharCode(0x3000);
const RAW_SPELLINGS = [
  ...[" ", NBSP, IDEOGRAPHIC, '"', "<", ">", "`"].map(
    (brk) => `https://rpc.example/v1/key${brk}secret`,
  ),
  "https:\\\\rpc.example\\v1\\key",
  "https:rpc.example/v1/key",
  "https:///rpc.example/v1/key",
  "https://rpc.example/v1/k\tey",
  "HTTPS://RPC.example/v1/key",
];
const POOL = "0x1";
// A raw spelling an earlier build stored, with the spelling it now reads as.
const legacy = (host: string) => ({
  canonical: `https://${host}/v1/key%20secret`,
  raw: `https:\\\\${host}\\v1\\key secret`,
});
// Over the 2,048-character cap once each space is percent-encoded.
const OUTGROWN = `https://rpc.example/${" ".repeat(1000)}key`;

const storedWith = async (fields: Readonly<Record<string, unknown>>) => {
  const store = createMemoryStore();
  await store.set(PREFERENCES_STORE_KEY, {
    ...defaultWalletPreferences(),
    ...fields,
  } as unknown as Json);
  return { preferences: createPreferencesStore({ store }), store };
};

describe("entered endpoints are canonical", () => {
  test("RPC, indexer and explorer endpoints in a raw spelling are refused", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    for (const raw of RAW_SPELLINGS) {
      await expect(
        preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: raw }),
      ).rejects.toThrow("Invalid RPC endpoint");
      await expect(preferences.setNftIndexerUrl({ url: raw })).rejects.toThrow(
        "Invalid indexer endpoint",
      );
      await expect(
        preferences.setExplorerFallback({ apiUrl: raw, enabled: true, networkId: "SN_MAIN" }),
      ).rejects.toThrow("Invalid explorer API endpoint");
    }
    await expect(
      preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: "https://rpc.example/v1/key" }),
    ).resolves.toMatchObject({ rpcOverrides: { SN_MAIN: "https://rpc.example/v1/key" } });
  });

  test("a Nostr relay in a raw spelling is refused", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    for (const relayUrl of [
      `wss://relay.example/k${NBSP}ey`,
      "wss:\\\\relay.example\\key",
      "WSS://relay.example",
    ]) {
      await expect(preferences.setNostrRelayUrl({ relayUrl })).rejects.toThrow(
        "Invalid Nostr relay endpoint",
      );
    }
    await expect(
      preferences.setNostrRelayUrl({ relayUrl: "wss://relay.example" }),
    ).resolves.toMatchObject({ nostrRelayUrl: "wss://relay.example" });
  });

  test("a STRK20 configuration with a raw spelling in any endpoint is refused", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    const base = DEFAULT_STRK20_NETWORKS.SN_MAIN;
    if (!base?.paymaster) throw new Error("missing bundled mainnet config");
    for (const config of [
      { ...base, proverUrl: `https://prover.example/a${IDEOGRAPHIC}b` },
      { ...base, discoveryUrl: `https://discovery.example/a${NBSP}b` },
      { ...base, ohttpRelayUrl: "https:relay.example/ohttp" },
      { ...base, paymaster: { ...base.paymaster, url: "https://paymaster.example\\key" } },
    ]) {
      await expect(
        preferences.setStrk20NetworkConfig({ config, networkId: "SN_MAIN" }),
      ).rejects.toThrow("Invalid STRK20 network configuration");
    }
  });

  test("every bundled endpoint is already canonical", () => {
    for (const network of Object.values(STARKNET_NETWORKS)) {
      expect(network.rpcUrls.every(isServiceUrl)).toBe(true);
    }
    expect(isStrk20NetworkConfigs(DEFAULT_STRK20_NETWORKS)).toBe(true);
  });
});

describe("stored endpoints are carried to the canonical spelling", () => {
  const rpc = legacy("rpc.example");
  const explorer = legacy("explorer.example");
  const indexer = legacy("indexer.example");
  const prover = legacy("prover.example");
  const discovery = legacy("discovery.example");
  const paymaster = legacy("paymaster.example");
  const relay = legacy("relay.example");
  const chainRpc = legacy("rpc.katana.example");
  const record = {
    customNetworks: [
      { chainId: "0x534e5f4b4154414e41", id: "katana", name: "Katana", rpcUrls: [chainRpc.raw] },
    ],
    explorerApiUrls: { SN_SEPOLIA: explorer.raw },
    nftIndexerUrl: indexer.raw,
    nostrRelayUrl: "WSS://Relay.Example\\key secret",
    rpcOverrides: { SN_MAIN: rpc.raw },
    strk20Networks: {
      SN_MAIN: {
        discoveryUrl: discovery.raw,
        ohttpRelayUrl: relay.raw,
        paymaster: { feeToken: POOL, url: paymaster.raw },
        poolAddress: POOL,
        proverUrl: prover.raw,
      },
    },
    strk20ProverUrl: prover.raw,
  };
  const canonical = {
    customNetworks: [
      {
        chainId: "0x534e5f4b4154414e41",
        id: "katana",
        name: "Katana",
        rpcUrls: [chainRpc.canonical],
      },
    ],
    explorerApiUrls: { SN_SEPOLIA: explorer.canonical },
    nftIndexerUrl: indexer.canonical,
    nostrRelayUrl: "wss://relay.example/key%20secret",
    rpcOverrides: { SN_MAIN: rpc.canonical },
    strk20Networks: {
      SN_MAIN: {
        discoveryUrl: discovery.canonical,
        ohttpRelayUrl: relay.canonical,
        paymaster: { feeToken: POOL, url: paymaster.canonical },
        poolAddress: POOL,
        proverUrl: prover.canonical,
      },
    },
    strk20ProverUrl: prover.canonical,
  };

  test("a record an earlier build stored loads with every endpoint canonical", async () => {
    const { preferences } = await storedWith(record);
    await expect(preferences.read()).resolves.toMatchObject(canonical);
  });

  test("the next write persists the canonical spelling", async () => {
    const { preferences, store } = await storedWith(record);
    await preferences.setDisplay({ theme: "light" });
    const persisted = JSON.stringify(await store.get(PREFERENCES_STORE_KEY));
    expect(persisted).not.toContain("\\\\");
    expect(persisted).not.toContain("key secret");
    expect(await store.get(PREFERENCES_STORE_KEY)).toMatchObject(canonical);
  });

  test("a backup written by an earlier build still restores", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    const backup = { ...defaultWalletPreferences(), ...record, theme: "light" };
    const restored = await preferences.importPreferences(backup);
    expect(restored.theme).toBe("light");
    // A restore never applies an endpoint (pickImportablePreferences).
    expect(restored.rpcOverrides).toEqual({});
  });

  test("an endpoint whose canonical spelling outgrows the cap is dropped, not fatal", async () => {
    const { preferences } = await storedWith({
      customNetworks: [
        { chainId: "0x534e5f4b4154414e41", id: "katana", name: "Katana", rpcUrls: [OUTGROWN] },
      ],
      nostrRelayUrl: OUTGROWN.replace("https:", "wss:"),
      rpcOverrides: { SN_MAIN: OUTGROWN, SN_SEPOLIA: rpc.raw },
      strk20Networks: {
        SN_MAIN: { discoveryUrl: discovery.raw, poolAddress: POOL, proverUrl: OUTGROWN },
        SN_SEPOLIA: { discoveryUrl: discovery.raw, poolAddress: POOL, proverUrl: prover.raw },
      },
    });
    const read = await preferences.read();
    // The built-in RPC and relays apply where the override was dropped, and the
    // explorer fallback stays off there, as it was with the override.
    expect(read.rpcOverrides).toEqual({ SN_SEPOLIA: rpc.canonical });
    expect(read.explorerFallback).toEqual({ SN_MAIN: false });
    expect(read.nostrRelayUrl).toBeUndefined();
    // The network stays listed by chain id, without the RPC URL.
    expect(read.customNetworks).toEqual([
      { chainId: "0x534e5f4b4154414e41", id: "katana", name: "Katana" },
    ]);
    // Dropped whole, so privacy stays off on that network rather than falling
    // back to routing the user did not choose.
    expect(read.strk20Networks).toEqual({
      SN_SEPOLIA: {
        discoveryUrl: discovery.canonical,
        poolAddress: POOL,
        proverUrl: prover.canonical,
      },
    });
  });

  // The parser keeps a backtick in a query, and encoding it would change the
  // bytes sent, so such an endpoint has no canonical spelling (#674 review).
  test("an endpoint whose query keeps a backtick is dropped, keeping an explicit choice", async () => {
    const { preferences } = await storedWith({
      explorerApiUrls: { SN_MAIN: "https://explorer.example/v1?key=a`b" },
      explorerFallback: { SN_SEPOLIA: true },
      rpcOverrides: {
        SN_MAIN: "https://rpc.example/v1?key=a`b",
        SN_SEPOLIA: "https://rpc.example/v1?key=a`b",
      },
    });
    const read = await preferences.read();
    expect(read.rpcOverrides).toEqual({});
    expect(read.explorerApiUrls).toEqual({});
    expect(read.explorerFallback).toEqual({ SN_MAIN: false, SN_SEPOLIA: true });
  });

  // A map is rebuilt with own properties, so a `__proto__` key reaches the
  // validator instead of vanishing through the prototype setter (#674 review).
  test("a map with a __proto__ key still fails closed once rebuilt", async () => {
    const hostile = JSON.parse(
      `{"__proto__": "https://evil.example", "SN_MAIN": ${JSON.stringify(rpc.raw)}}`,
    );
    expect(Object.hasOwn(hostile, "__proto__")).toBe(true);
    for (const field of ["rpcOverrides", "explorerApiUrls"]) {
      const { preferences } = await storedWith({ [field]: hostile });
      await expect(preferences.read()).rejects.toThrow("Invalid stored preferences");
      const backup = { ...defaultWalletPreferences(), [field]: hostile };
      await expect(
        createPreferencesStore({ store: createMemoryStore() }).importPreferences(backup),
      ).rejects.toThrow("Invalid preferences backup");
    }
  });

  // Dropping an endpoint must not drop the defect around it: an invalid key or
  // an otherwise invalid configuration still fails (#674 review).
  test("an endpoint with no canonical spelling is dropped only from a valid entry", async () => {
    const UNCARRIED = "https://rpc.example/v1?key=a`b";
    const routing = { discoveryUrl: discovery.raw, poolAddress: POOL, proverUrl: UNCARRIED };
    for (const fields of [
      { rpcOverrides: { BAD: UNCARRIED } },
      { explorerApiUrls: { BAD: OUTGROWN } },
      { strk20Networks: { BAD: routing } },
      { strk20Networks: { SN_MAIN: { ...routing, poolAddress: "0x0" } } },
      { strk20Networks: { SN_MAIN: { ...routing, apiKey: "secret" } } },
      {
        strk20Networks: {
          SN_MAIN: {
            ...routing,
            proverUrl: prover.raw,
            paymaster: { feeToken: "", url: OUTGROWN },
          },
        },
      },
    ]) {
      const { preferences } = await storedWith(fields);
      await expect(preferences.read()).rejects.toThrow("Invalid stored preferences");
      await expect(
        createPreferencesStore({ store: createMemoryStore() }).importPreferences({
          ...defaultWalletPreferences(),
          ...fields,
        }),
      ).rejects.toThrow("Invalid preferences backup");
    }
  });

  // A null endpoint is no value an earlier build stored, so neither the
  // stand-in for a dropped endpoint nor the drop itself may make it valid
  // (#674 review).
  test("a null STRK20 endpoint still fails closed, alone or beside a dropped one", async () => {
    const UNCARRIED = "https://rpc.example/v1?key=a`b";
    const routing = {
      discoveryUrl: discovery.canonical,
      ohttpRelayUrl: relay.canonical,
      paymaster: { feeToken: POOL, url: paymaster.canonical },
      poolAddress: POOL,
      proverUrl: prover.canonical,
    };
    const nulled = [
      { ...routing, discoveryUrl: null },
      { ...routing, ohttpRelayUrl: null },
      { ...routing, proverUrl: null },
      { ...routing, paymaster: { feeToken: POOL, url: null } },
    ];
    const besideDropped = nulled.map((config) =>
      config.discoveryUrl === null
        ? { ...config, proverUrl: UNCARRIED }
        : { ...config, discoveryUrl: UNCARRIED },
    );
    for (const config of [...nulled, ...besideDropped]) {
      const fields = { strk20Networks: { SN_MAIN: config } };
      const { preferences } = await storedWith(fields);
      await expect(preferences.read()).rejects.toThrow("Invalid stored preferences");
      await expect(
        createPreferencesStore({ store: createMemoryStore() }).importPreferences({
          ...defaultWalletPreferences(),
          ...fields,
        }),
      ).rejects.toThrow("Invalid preferences backup");
    }
  });

  test("an endpoint the earlier rule refused still fails closed", async () => {
    for (const fields of [
      { rpcOverrides: { SN_MAIN: "http://rpc.example/v1" } },
      { nftIndexerUrl: "ftp://indexer.example" },
      { nostrRelayUrl: "https://relay.example" },
      { strk20Networks: { SN_MAIN: { discoveryUrl: "", poolAddress: POOL, proverUrl: "" } } },
    ]) {
      const { preferences } = await storedWith(fields);
      await expect(preferences.read()).rejects.toThrow("Invalid stored preferences");
    }
  });
});
