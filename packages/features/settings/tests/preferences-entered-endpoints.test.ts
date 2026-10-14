/**
 * An entered endpoint must redact whole: `redactEndpoints` ends a URL at any
 * whitespace (Unicode included) or a quote, angle bracket or backtick, so an
 * endpoint holding one could leave part of an API key visible in a redacted
 * error. Every settings input refuses such an endpoint; a stored record that
 * already holds one still loads, because tightening the stored rule could make a
 * record that reads today unreadable.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_STRK20_NETWORKS } from "@bramble/privacy/config";
import {
  createPreferencesStore,
  defaultWalletPreferences,
  PREFERENCES_STORE_KEY,
} from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";

const NBSP = String.fromCharCode(0xa0);
const IDEOGRAPHIC = String.fromCharCode(0x3000);
const BREAKS = [" ", NBSP, IDEOGRAPHIC, '"', "<", ">", "`"];
const keyed = (brk: string): string => `https://rpc.example/v1/key${brk}secret`;

describe("entered endpoints redact whole", () => {
  test("RPC, indexer and explorer endpoints with a redaction break are refused", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    for (const brk of BREAKS) {
      await expect(
        preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: keyed(brk) }),
      ).rejects.toThrow("Invalid RPC endpoint");
      await expect(preferences.setNftIndexerUrl({ url: keyed(brk) })).rejects.toThrow(
        "Invalid indexer endpoint",
      );
      await expect(
        preferences.setExplorerFallback({
          apiUrl: keyed(brk),
          enabled: true,
          networkId: "SN_MAIN",
        }),
      ).rejects.toThrow("Invalid explorer API endpoint");
    }
    await expect(
      preferences.setRpcOverride({ networkId: "SN_MAIN", rpcUrl: "https://rpc.example/v1/key" }),
    ).resolves.toMatchObject({ rpcOverrides: { SN_MAIN: "https://rpc.example/v1/key" } });
  });

  test("a Nostr relay with a redaction break is refused", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    await expect(
      preferences.setNostrRelayUrl({ relayUrl: `wss://relay.example/k${NBSP}ey` }),
    ).rejects.toThrow("Invalid Nostr relay endpoint");
  });

  test("a STRK20 configuration with a redaction break in any endpoint is refused", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    const base = DEFAULT_STRK20_NETWORKS.SN_MAIN;
    if (!base) throw new Error("missing bundled mainnet config");
    for (const config of [
      { ...base, proverUrl: `https://prover.example/a${IDEOGRAPHIC}b` },
      { ...base, discoveryUrl: `https://discovery.example/a${NBSP}b` },
    ]) {
      await expect(
        preferences.setStrk20NetworkConfig({ config, networkId: "SN_MAIN" }),
      ).rejects.toThrow("Invalid STRK20 network configuration");
    }
  });

  test("a stored record that already holds such an endpoint still loads", async () => {
    const store = createMemoryStore();
    const stored = { ...defaultWalletPreferences(), rpcOverrides: { SN_MAIN: keyed(" ") } };
    await store.set(PREFERENCES_STORE_KEY, JSON.parse(JSON.stringify(stored)));
    await expect(createPreferencesStore({ store }).read()).resolves.toMatchObject({
      rpcOverrides: { SN_MAIN: keyed(" ") },
    });
  });
});
