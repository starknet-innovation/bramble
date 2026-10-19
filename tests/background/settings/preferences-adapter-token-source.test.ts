/**
 * The background's production preferences wiring keeps the token source
 * (audit 171). `index.ts` hands every handler `createBackgroundPreferences`
 * over the real preferences store, so a dapp add (wallet_watchAsset) only
 * reaches `dappTokenIds` if the adapter forwards the caller's source instead of
 * substituting its own. The store-level tests cannot see that hop.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { withTokenId } from "@bramble/wallet-model/preferences";
import { createBackgroundPreferences } from "../../../apps/extension/src/background/settings/preferences-adapter";

const PLAIN = {
  address: "0x0777000000000000000000000000000000000000000000000000000000000002",
  decimals: 6,
  name: "Plain",
  networkId: "SN_SEPOLIA" as const,
  symbol: "PLAIN",
};
const plainId = withTokenId(PLAIN).id;

const productionPreferences = () => {
  const store = createPreferencesStore({ store: createMemoryStore() });
  const adapter = createBackgroundPreferences({
    onApprovalSurface: () => undefined,
    onProductAnalytics: () => undefined,
    onReliabilityDiagnostics: () => undefined,
    store: Promise.resolve(store),
  });
  return { adapter, store };
};

describe("createBackgroundPreferences token source", () => {
  test("a dapp add through the adapter is recorded as dapp-supplied", async () => {
    const { adapter, store } = productionPreferences();
    const next = await adapter.upsertToken(PLAIN, "dapp");
    expect(next.dappTokenIds).toEqual([plainId]);
    expect((await store.read()).dappTokenIds).toEqual([plainId]);
  });

  test("a later user add of the same token through the adapter clears the mark", async () => {
    const { adapter, store } = productionPreferences();
    await adapter.upsertToken(PLAIN, "dapp");
    const next = await adapter.upsertToken(PLAIN, "user");
    expect(next.dappTokenIds).toEqual([]);
    expect((await store.read()).dappTokenIds).toEqual([]);
  });
});
