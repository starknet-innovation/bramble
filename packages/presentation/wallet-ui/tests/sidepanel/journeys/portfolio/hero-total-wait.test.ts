/**
 * Home's hero holds "—" for pending private discovery for at most
 * PRIVATE_TOTAL_WAIT_MS, then shows the public total, and takes in the
 * private part when discovery settles (issue 795). The wait belongs to one
 * account and network: a switch starts a fresh one, and a timer armed for the
 * old account can never end the new account's wait. The held hero keeps its
 * change line's space so nothing moves when the figure arrives.
 */
import { describe, expect, test } from "bun:test";
import type { TokenConfig, WalletPreferences } from "@bramble/settings/preferences";
import { account, secondAccount } from "@bramble/testkit/sidepanel";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import {
  emptyRenderCache,
  type RenderData,
} from "../../../../src/sidepanel/app/rendering/render-cache";
import {
  type SceneContentState,
  sceneContent,
} from "../../../../src/sidepanel/app/screens/scene-content";
import {
  createHeroTotalWait,
  type HeroTotalWait,
  PRIVATE_TOTAL_WAIT_MS,
} from "../../../../src/sidepanel/journeys/portfolio/hero-total-wait";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { manualTimers } from "../../../support/manual-timers";

const eth: TokenConfig = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
  id: "SN_MAIN:ETH:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};
const preferences: WalletPreferences = {
  activeNetworkId: "SN_MAIN",
  addressBook: [],
  schemaVersion: 1,
  tokens: [eth],
};
const statusFor = (activeAccountId: string): WalletStatus => ({
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
});
const cacheFor = (activeAccountId: string): RenderData => ({
  ...emptyRenderCache(),
  balances: {
    accountId: activeAccountId,
    balances: [{ ...eth, balance: "1250000000000000000", formatted: "1.25" }],
    networkId: "SN_MAIN",
  },
  changes: { [eth.address]: 4 },
  deployment: true,
  preferences,
  prices: { [eth.address]: 2_000 },
  status: statusFor(activeAccountId),
});

const discovering: PrivacyDisclosureState = { error: null, loading: true, value: null };
const settledFor = (accountId: string): PrivacyDisclosureState => ({
  error: null,
  loading: false,
  value: {
    accountId,
    balances: [
      {
        balance: "0x6f05b59d3b20000",
        formatted: "0.5",
        symbol: "ETH",
        token: eth.address,
        tokenId: eth.id,
      },
    ],
    networkId: "SN_MAIN",
    poolFeeFri: "0x1",
    relayConfigured: true,
    registration: "registered",
  },
});

const state: Omit<SceneContentState, "privacy" | "privateTotalWaitOver"> = {
  activeView: "home",
  addFolderOpen: false,
  collapsedFolders: [],
  expandedGroupId: null,
  fullPageOnboarding: false,
  ledgerAvailable: true,
  privacyJourney: { stage: "idle" },
  selectedMultisigId: null,
  selectedMultisigIntentId: null,
  selectedNftId: null,
  selectedTokenId: null,
  sendIntent: null,
  snoozedApprovalIds: [],
  todayKey: null,
};

// One paint as the side panel does it: ask the wait, then draw; returns the hero.
const paintHero = (wait: HeroTotalWait, cache: RenderData, privacy: PrivacyDisclosureState) => {
  const html = sceneContent(cache, {
    ...state,
    privacy,
    privateTotalWaitOver: wait.sync(cache.status, privacy, cache.deployment),
  });
  return html.slice(html.indexOf('class="hero"'), html.indexOf("home-actions"));
};
const totalOf = (hero: string): string => hero.match(/class="hero-total"[^>]*>([^<]*)</)?.[1] ?? "";

const setup = () => {
  const timers = manualTimers();
  let paints = 0;
  const wait = createHeroTotalWait({
    paint: () => {
      paints += 1;
    },
    timers,
  });
  return { paints: () => paints, timers, wait };
};

describe("hero total wait", () => {
  test("the cap is one named value of about three seconds", () => {
    expect(PRIVATE_TOTAL_WAIT_MS).toBe(3_000);
  });

  test("holds — before the cap, then shows the public total, then the combined one", () => {
    const { paints, timers, wait } = setup();
    const cache = cacheFor(account.id);

    expect(totalOf(paintHero(wait, cache, discovering))).toBe("—");
    timers.advance(PRIVATE_TOTAL_WAIT_MS - 1);
    // A repaint within the wait neither shows the total nor restarts the wait.
    expect(totalOf(paintHero(wait, cache, discovering))).toBe("—");
    expect(paints()).toBe(0);

    timers.advance(1);
    expect(paints()).toBe(1);
    // 1.25 public ETH at $2,000.
    expect(totalOf(paintHero(wait, cache, discovering))).toBe("$2,500.00");

    // Settled: 1.25 public + 0.5 private ETH.
    expect(totalOf(paintHero(wait, cache, settledFor(account.id)))).toBe("$3,500.00");
  });

  test("the hero keeps the same lines while held, so the figure arriving moves nothing", () => {
    const { timers, wait } = setup();
    const cache = cacheFor(account.id);
    const held = paintHero(wait, cache, discovering);
    timers.advance(PRIVATE_TOTAL_WAIT_MS);
    const shown = paintHero(wait, cache, discovering);

    const lines = (hero: string) => hero.match(/<p class="[^"]*/g);
    expect(lines(held)).toEqual(['<p class="hero-total', '<p class="hero-change is-held']);
    expect(held).toContain('is-held" aria-hidden="true"');
    expect(lines(shown)).toEqual(['<p class="hero-total', '<p class="hero-change']);
  });

  test("an account switch starts a fresh wait the old account's timer cannot end", () => {
    const { paints, timers, wait } = setup();
    // Account A shows its total after the cap.
    paintHero(wait, cacheFor(account.id), discovering);
    timers.advance(PRIVATE_TOTAL_WAIT_MS);
    expect(totalOf(paintHero(wait, cacheFor(account.id), discovering))).not.toBe("—");

    // Switching to B holds "—" again, for a full wait of its own.
    const b = cacheFor(secondAccount.id);
    expect(totalOf(paintHero(wait, b, discovering))).toBe("—");
    timers.advance(PRIVATE_TOTAL_WAIT_MS - 1);
    expect(totalOf(paintHero(wait, b, discovering))).toBe("—");
    timers.advance(1);
    expect(totalOf(paintHero(wait, b, discovering))).toBe("$2,500.00");
    expect(paints()).toBe(2);
  });

  test("a timer armed for the previous account is cleared on the switch", () => {
    const { paints, timers, wait } = setup();
    paintHero(wait, cacheFor(account.id), discovering);
    timers.advance(1_000);
    const b = cacheFor(secondAccount.id);
    paintHero(wait, b, discovering);
    expect(timers.pending()).toBe(1);

    // A's wait would have ended here; B's has 1 s to go.
    timers.advance(PRIVATE_TOTAL_WAIT_MS - 1_000);
    expect(paints()).toBe(0);
    expect(totalOf(paintHero(wait, b, discovering))).toBe("—");
    timers.advance(1_000);
    expect(paints()).toBe(1);
  });

  test("a previous account's timer that fires anyway cannot end the new wait", () => {
    // A callback already queued when the switch cleared it still runs: model it
    // with timers whose clear does nothing.
    const timers = manualTimers();
    let paints = 0;
    const wait = createHeroTotalWait({
      paint: () => {
        paints += 1;
      },
      timers: { ...timers, clear: () => undefined },
    });
    paintHero(wait, cacheFor(account.id), discovering);
    timers.advance(1_000);
    const b = cacheFor(secondAccount.id);
    paintHero(wait, b, discovering);

    timers.advance(PRIVATE_TOTAL_WAIT_MS - 1_000);
    expect(paints).toBe(0);
    expect(totalOf(paintHero(wait, b, discovering))).toBe("—");
  });

  test("a queued timer cannot end a later wait for the same account", () => {
    // A -> B -> A, and lock -> unlock on A: the first timer's callback still runs.
    for (const away of [
      (_: RenderData) => cacheFor(secondAccount.id).status,
      (cache: RenderData) => ({ ...cache.status, locked: true }),
    ]) {
      const timers = manualTimers();
      let paints = 0;
      const wait = createHeroTotalWait({
        paint: () => {
          paints += 1;
        },
        timers: { ...timers, clear: () => undefined },
      });
      const a = cacheFor(account.id);
      paintHero(wait, a, discovering);
      timers.advance(1_000);
      wait.sync(away(a), discovering, true);
      paintHero(wait, a, discovering);

      timers.advance(PRIVATE_TOTAL_WAIT_MS - 1_000);
      expect(paints).toBe(0);
      expect(totalOf(paintHero(wait, a, discovering))).toBe("—");
      timers.advance(1_000);
      expect(paints).toBe(1);
    }
  });

  test("locking ends the wait, and unlocking starts a fresh one", () => {
    const { timers, wait } = setup();
    const cache = cacheFor(account.id);
    paintHero(wait, cache, discovering);
    timers.advance(PRIVATE_TOTAL_WAIT_MS);
    expect(totalOf(paintHero(wait, cache, discovering))).toBe("$2,500.00");

    expect(wait.sync({ ...cache.status, locked: true }, discovering, true)).toBe(false);
    expect(timers.pending()).toBe(0);
    expect(totalOf(paintHero(wait, cache, discovering))).toBe("—");
  });

  test("privacy off never arms the wait", () => {
    const { timers, wait } = setup();
    const ledger: PrivacyDisclosureState = {
      blockerKind: "ledger",
      error: "Private balances unavailable",
      loading: false,
      value: null,
    };
    expect(totalOf(paintHero(wait, cacheFor(account.id), ledger))).toBe("$2,500.00");
    expect(timers.pending()).toBe(0);
  });
});
