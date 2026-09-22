/**
 * Swap's two token dropdowns: what each group holds, and what picking an
 * untracked catalog entry does.
 *
 * The catalog is a directory. A token the wallet does not track is added
 * through the wallet's own add-token path — which reads its facts from the
 * contract — and the selection is delivered only once it is tracked, so Swap
 * never holds a token the registry has not vouched for.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type { SwapCatalogTokenView } from "../../../../src/sidepanel/journeys/swap/swap-client";
import {
  bindSwapTokenDropdowns,
  resetSwapCatalogForTests,
} from "../../../../src/sidepanel/journeys/swap/swap-picker";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { tokenDropdownShell } from "../../../../src/sidepanel/shared/token-dropdown";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const EKUBO = "0x075afe6402ad5a5c20dd25e10ec3b3986acaa647b77e4ae24b0cbc9a54a27a87";

// Tracked tokens are per network, so the fixture follows the network the case
// runs on — otherwise nothing counts as held and every entry reads as new.
const trackedOn = (networkId: string): TokenConfig =>
  ({
    address: STRK,
    decimals: 18,
    id: `${networkId}:STRK`,
    name: "Starknet Token",
    networkId,
    symbol: "STRK",
  }) as unknown as TokenConfig;

const status = (networkId: string): WalletStatus =>
  ({
    accountCount: 1,
    accounts: [],
    activeAccountId: null,
    hasVault: true,
    locked: false,
    network: "Starknet Mainnet",
    networkId,
    networks: [{ id: networkId, name: "Starknet Mainnet" }],
    ready: true,
  }) as unknown as WalletStatus;

const CATALOG: readonly SwapCatalogTokenView[] = [
  { address: STRK, decimals: 18, name: "Starknet Token", symbol: "STRK" },
  { address: EKUBO, decimals: 18, name: "Ekubo Protocol", symbol: "EKUBO" },
];

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const mount = async (
  networkId: string,
): Promise<{
  added: string[];
  picks: [string, string][];
  root: HTMLElement;
  tokens: TokenConfig[];
}> => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  for (const side of ["sell", "buy"]) {
    const wrapper = document.createElement("div");
    wrapper.className = "token-dropdown";
    wrapper.innerHTML = `<button id="swap-${side}-token" type="button">Select</button>${tokenDropdownShell(
      `swap-${side}-options`,
      "Tokens",
    )}`;
    root.append(wrapper);
  }
  document.body.append(root);

  const tokens: TokenConfig[] = [trackedOn(networkId)];
  const added: string[] = [];
  const picks: [string, string][] = [];
  const deps = {
    balances: () => ({ balances: [] }),
    preferences: () => ({ tokens }) as unknown as WalletPreferences,
    render: async () => undefined,
    status: () => status(networkId),
    swap: { tokens: async () => CATALOG },
    wallet: {
      addToken: async (address: string) => {
        added.push(address);
        tokens.push({
          ...trackedOn(networkId),
          address,
          id: `${networkId}:EKUBO`,
          symbol: "EKUBO",
        });
      },
      loadStatus: async () => status(networkId),
    } as unknown as SidepanelWallet,
  } as unknown as Parameters<typeof bindSwapTokenDropdowns>[0];

  bindSwapTokenDropdowns(deps, root, (side, tokenId) => picks.push([side, tokenId]));
  await flush();
  // Bound again the way a repaint does, now that the catalog has landed.
  bindSwapTokenDropdowns(deps, root, (side, tokenId) => picks.push([side, tokenId]));
  return { added, picks, root, tokens };
};

const labels = (root: HTMLElement, side: string): readonly string[] =>
  [
    ...(root
      .querySelector(`#swap-${side}-options`)
      ?.querySelectorAll<HTMLElement>(".token-dropdown-label, [data-token-option]") ?? []),
  ].map((node) => node.dataset["tokenSymbol"] ?? (node.textContent ?? "").trim());

describe("swap token dropdowns", () => {
  beforeEach(() => {
    resetSwapCatalogForTests();
    document.body.replaceChildren();
  });

  test("lists what the account holds, then the rest of the catalog", async () => {
    const { root } = await mount("SN_MAIN");

    expect(labels(root, "sell")).toEqual(["Your tokens", "STRK", "More tokens", "EKUBO"]);
    expect(labels(root, "buy")).toEqual(["Your tokens", "STRK", "More tokens", "EKUBO"]);
  });

  test("a tracked pick reports its token id straight away", async () => {
    const { added, picks, root } = await mount("SN_SEPOLIA");

    root.querySelector<HTMLButtonElement>("#swap-sell-token")?.click();
    root
      .querySelector(`#swap-sell-options`)
      ?.querySelector<HTMLButtonElement>("[data-token-option]")
      ?.click();

    expect(picks).toEqual([["sell", "SN_SEPOLIA:STRK"]]);
    expect(added).toEqual([]);
  });

  test("an untracked pick is added first, then delivered as a tracked token", async () => {
    const { added, picks, root } = await mount("SN_DEVNET");

    root.querySelector<HTMLButtonElement>("#swap-buy-token")?.click();
    const options = root
      .querySelector("#swap-buy-options")
      ?.querySelectorAll<HTMLButtonElement>("[data-token-option]");
    options?.[1]?.click();
    await flush();

    expect(added).toEqual([EKUBO]);
    expect(picks).toEqual([["buy", "SN_DEVNET:EKUBO"]]);
  });
});
