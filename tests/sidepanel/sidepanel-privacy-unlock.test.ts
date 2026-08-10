/**
 * The privacy entry point for a hardware account whose viewing key has not been
 * derived on the device yet.
 *
 * Registering publishes the viewing key's commitment, so the ceremony has to run
 * first. These pin that the shared entry point runs the ceremony instead of
 * preparing a registration, that it re-reads state afterwards so the surface
 * stops asking, and that it never prepares a registration in that state.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { WalletStatus } from "../../src/popup/responses";
import type { PrivacyAccountState } from "../../src/sidepanel/privacy-runtime";
import { bindPrivacy } from "../../src/sidepanel/privacy-ui";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import { registerDom, unregisterDom } from "../support/groups-harness";
import { account, preferences } from "../support/sidepanel-fixtures";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const status: WalletStatus = {
  accountCount: 1,
  accounts: [account],
  activeAccountId: account.id,
  hasVault: true,
  locked: false,
  network: "Starknet Mainnet",
  networkId: "SN_MAIN",
  networks: [{ id: "SN_MAIN", name: "Starknet Mainnet" }],
  ready: true,
};

const TOKEN_ID = preferences.tokens[0]?.id ?? "SN_MAIN:ETH:0x1";

const stateWith = (
  privateBalances: PrivacyAccountState["privateBalances"],
): PrivacyAccountState => ({
  accountId: account.id,
  balances: [],
  networkId: "SN_MAIN",
  poolFeeFri: "0x1",
  privateBalances,
  registration: "unregistered",
  relayConfigured: true,
});

const bindWith = (options: { readonly ceremony?: () => Promise<void> } = {}) => {
  const derived: number[] = [];
  const registrations: number[] = [];
  const painted: number[] = [];
  // Flips to `ready` once the ceremony has run, the way the background does.
  let state = stateWith("setup-required");
  const app = document.createElement("main");
  app.innerHTML = `<button data-privacy-register="${TOKEN_ID}">Go private</button>`;
  document.body.append(app);
  bindPrivacy({
    app,
    balances: () => [],
    disclosure: () => ({ error: null, loading: false, value: state }),
    generation: () => 0,
    journey: () => ({ stage: "idle" }),
    navigate: () => undefined,
    openSend: () => undefined,
    paint: () => painted.push(1),
    preferences: () => preferences,
    setDisclosure: () => undefined,
    setJourney: () => undefined,
    status: () => status,
    wallet: {
      async derivePrivacyViewingKey() {
        derived.push(1);
        if (options.ceremony) {
          await options.ceremony();
        }
        state = stateWith("ready");
      },
      async loadPrivacyState() {
        return state;
      },
      async preparePrivacyRegistration() {
        registrations.push(1);
        throw new Error("registration must not be prepared before the key exists");
      },
    } as unknown as SidepanelWallet,
  });
  return { app, derived, painted, registrations, state: () => state };
};

const click = (app: HTMLElement): void => {
  app
    .querySelector<HTMLButtonElement>("[data-privacy-register]")
    ?.dispatchEvent(new Event("click"));
};

const settle = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

describe("privacy entry point with no retained viewing key", () => {
  test("runs the device ceremony instead of preparing a registration", async () => {
    const bound = bindWith();

    click(bound.app);
    await settle();

    expect(bound.derived).toHaveLength(1);
    // Registering publishes the key's commitment, so it cannot come first. The
    // stub throws if reached, but assert the count too so a swallowed error in the
    // handler could not make this pass silently.
    expect(bound.registrations).toHaveLength(0);
  });

  test("re-reads state after the ceremony so the surface stops asking", async () => {
    const bound = bindWith();

    click(bound.app);
    await settle();

    expect(bound.state().privateBalances).toBe("ready");
    expect(bound.painted.length).toBeGreaterThan(0);
  });

  test("a failed ceremony leaves the account in the setup state", async () => {
    const bound = bindWith({
      ceremony: () => Promise.reject(new Error("rejected-on-device")),
    });

    click(bound.app);
    await settle();

    // The rejection must not be mistaken for success: nothing is registered and
    // the surface still asks for the ceremony.
    expect(bound.registrations).toHaveLength(0);
    expect(bound.state().privateBalances).toBe("setup-required");
  });
});
