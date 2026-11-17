/**
 * The token detail chart is one cache slot shared by every token screen, so
 * hydration records which token a chart was read for (Sherlock 210). The scene
 * draws it only on that token's screen; see scene-content.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { knownTokensForNetwork } from "@bramble/portfolio/token-registry";
import { preferences } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { hydrateView } from "../../../../src/sidepanel/app/sync/hydrate";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";

const status: WalletStatus = {
  accountCount: 1,
  accounts: [],
  activeAccountId: "SN_MAIN:0x1",
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

// Every wallet read the token detail view does not care about rejects, which
// hydration already tolerates; only the chart answers.
const walletWith = (chart: readonly number[]): SidepanelWallet =>
  new Proxy({} as SidepanelWallet, {
    get: (_target, property) =>
      property === "loadTokenChart"
        ? async () => chart
        : async () => {
            throw new Error(`${String(property)} not stubbed`);
          },
  });

describe("token detail hydration", () => {
  test("records the token a chart was read for", async () => {
    const eth = knownTokensForNetwork("SN_MAIN").find((token) => token.symbol === "ETH");
    if (!eth) throw new Error("registry fixture missing");
    const cache = { ...emptyRenderCache(), preferences: { ...preferences, tokens: [eth] }, status };
    await hydrateView({
      activeView: "token-detail",
      cache,
      deployment: { load: async () => null },
      multisig: { loadMultisigs: async () => ({ intents: [], multisigs: [] }) },
      paint: () => undefined,
      selectedMultisigId: null,
      selectedTokenId: eth.id,
      signability: { load: async () => null },
      status,
      wallet: walletWith([4_000, 4_200]),
    } as unknown as Parameters<typeof hydrateView>[0]);

    expect(cache.chart).toEqual([4_000, 4_200]);
    expect(cache.chartTokenId).toBe(eth.id);
  });
});
