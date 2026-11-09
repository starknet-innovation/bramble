/**
 * How users reach staking (issue 750): "Stake" on a token's screen, shown only
 * where staking is on and the token is stakable (STRK, or a token the staking
 * screen already read on chain), opening the staking list; and the Settings
 * row under "This account", shown only on a staking network.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { account } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import type { RenderData } from "../../../../src/sidepanel/app/rendering/render-cache";
import { bindClusterScreens } from "../../../../src/sidepanel/app/screens/cluster-ui";
import { dashboard } from "../../../../src/sidepanel/app/screens/views";
import { tokenDetailFlow } from "../../../../src/sidepanel/journeys/portfolio/token-flows";
import { settingsScreen } from "../../../../src/sidepanel/journeys/settings/settings-views";
import type { StakingRow } from "../../../../src/sidepanel/journeys/staking/staking-client";
import {
  STAKING_LOADING,
  type StakingState,
} from "../../../../src/sidepanel/journeys/staking/staking-directory-client";
import { canStakeToken } from "../../../../src/sidepanel/journeys/staking/staking-entry";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const statusOn = (networkId: "SN_MAIN" | "SN_SEPOLIA"): WalletStatus => ({
  accountCount: 1,
  accounts: [{ ...account, networkId }],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: networkId === "SN_MAIN" ? "Starknet Mainnet" : "Starknet Sepolia",
  networkId,
  networks: [{ id: networkId, name: "Starknet" }],
  ready: true,
});

const preferences = defaultWalletPreferences();
const tokenOn = (networkId: string, symbol: string) => {
  const token = preferences.tokens.find(
    (entry) => entry.networkId === networkId && entry.symbol === symbol,
  );
  if (!token) throw new Error(`${symbol} fixture missing on ${networkId}`);
  return token;
};
const STRK = tokenOn("SN_MAIN", "STRK");
const ETH = tokenOn("SN_MAIN", "ETH");
const BTC = { address: "0xb7c", id: "SN_MAIN:0xb7c" };

const row = (tokenId: string): StakingRow => ({
  staker: "0xa1",
  symbol: "WBTC",
  tokenId,
  refusal: "This validator has no pool for this token.",
});

describe("canStakeToken", () => {
  test("STRK on Mainnet, where staking is on", () => {
    expect(canStakeToken("SN_MAIN", STRK, STAKING_LOADING)).toBe(true);
  });

  test("not where staking is off", () => {
    expect(canStakeToken("SN_SEPOLIA", tokenOn("SN_SEPOLIA", "STRK"), STAKING_LOADING)).toBe(false);
    expect(canStakeToken("SN_DEVNET", STRK, STAKING_LOADING)).toBe(false);
  });

  test("not for a token staking doesn't take", () => {
    expect(canStakeToken("SN_MAIN", ETH, STAKING_LOADING)).toBe(false);
  });

  test("a BTC token once the staking screen read it on chain, from a validator or Your stakes", () => {
    expect(canStakeToken("SN_MAIN", BTC, STAKING_LOADING)).toBe(false);
    const viaValidator: StakingState = {
      ...STAKING_LOADING,
      validator: { exitWindowSeconds: 1, rows: [row(BTC.id)] },
    };
    const viaPositions: StakingState = {
      ...STAKING_LOADING,
      positions: { complete: true, rows: [row(BTC.id)] },
    };
    expect(canStakeToken("SN_MAIN", BTC, viaValidator)).toBe(true);
    expect(canStakeToken("SN_MAIN", BTC, viaPositions)).toBe(true);
    expect(canStakeToken("SN_MAIN", ETH, viaPositions)).toBe(false);
  });
});

describe("Stake on the token screen", () => {
  const html = (stakable: boolean) =>
    tokenDetailFlow(
      statusOn("SN_MAIN"),
      STRK,
      undefined,
      [],
      null,
      "usd",
      undefined,
      true,
      stakable,
    );

  test("shows beside Send and Swap only when stakable", () => {
    expect(html(true)).toContain(`data-stake-token="${STRK.id}"`);
    expect(html(true)).toContain(">Stake<");
    expect(html(false)).not.toContain("data-stake-token");
    expect(html(false)).not.toContain(">Stake<");
  });

  const tokenScreen = (networkId: "SN_MAIN" | "SN_SEPOLIA", tokenId: string) =>
    dashboard(
      "token-detail",
      statusOn(networkId),
      [],
      preferences,
      { loading: true },
      true,
      [],
      [],
      {},
      [],
      tokenId,
    );

  test("the token screen offers it for STRK on Mainnet, not for ETH, and not on a network with staking off", () => {
    expect(tokenScreen("SN_MAIN", STRK.id)).toContain("data-stake-token");
    expect(tokenScreen("SN_MAIN", ETH.id)).not.toContain("data-stake-token");
    expect(tokenScreen("SN_SEPOLIA", tokenOn("SN_SEPOLIA", "STRK").id)).not.toContain(
      "data-stake-token",
    );
  });

  test("tapping it opens the staking list, not the validator open last", () => {
    const app = document.createElement("div");
    app.innerHTML = html(true);
    const cache = {
      staking: { ...STAKING_LOADING, selected: { name: null, staker: "0xa1" } },
    } as unknown as RenderData;
    const navigated: string[] = [];
    bindClusterScreens({
      app,
      cache,
      leaveSwap: () => undefined,
      navigate: (view) => navigated.push(view),
      openNft: () => undefined,
      openToken: () => undefined,
      openWithToken: () => undefined,
      render: async () => undefined,
      swap: {} as never,
      wallet: {} as never,
    });
    app.querySelector<HTMLButtonElement>("[data-stake-token]")?.click();
    expect(navigated).toEqual(["staking"]);
    expect(cache.staking.selected).toBeNull();
    expect(cache.staking.validator).toEqual({ loading: true });
  });
});

describe("the Settings row", () => {
  const section = (html: string, label: string): string => {
    const app = document.createElement("div");
    app.innerHTML = html;
    const group = app.querySelector(`[aria-label="${label}"]`);
    return group?.innerHTML ?? "";
  };

  test("sits under This account, not Access & permissions, on a staking network", () => {
    const html = settingsScreen(statusOn("SN_MAIN"), preferences);
    expect(section(html, "This account")).toContain('data-view="staking"');
    expect(section(html, "Access and permissions")).not.toContain('data-view="staking"');
  });

  test("is absent where staking is off", () => {
    expect(settingsScreen(statusOn("SN_SEPOLIA"), preferences)).not.toContain(
      'data-view="staking"',
    );
  });
});
