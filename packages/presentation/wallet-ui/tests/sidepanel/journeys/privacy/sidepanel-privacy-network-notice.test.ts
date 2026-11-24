/**
 * A network with no privacy pool gives the same answer on every disclosure
 * read, and every account switch reads again. That answer is stated inline and
 * never toasted, so switching accounts does not stack the same notice (issue
 * 951). Other failures still toast, but never as a duplicate of one on screen.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TokenConfig } from "@bramble/settings/preferences";
import { account, preferences, secondAccount } from "@bramble/testkit/sidepanel";
import { PrivacyBlockerError } from "@bramble/wallet-protocol/privacy-blocker";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { homeTabs } from "../../../../src/sidepanel/journeys/portfolio/home-tabs";
import { tokenDetailFlow } from "../../../../src/sidepanel/journeys/portfolio/token-flows";
import type { PrivacyDisclosureState } from "../../../../src/sidepanel/journeys/privacy/privacy-model";
import { bindPrivacy } from "../../../../src/sidepanel/journeys/privacy/privacy-ui";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { showToast } from "../../../../src/sidepanel/shared/dom";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);
beforeEach(() => document.body.replaceChildren());

const statusFor = (accountId: string): WalletStatus => ({
  accountCount: 2,
  accounts: [account, secondAccount],
  activeAccountId: accountId,
  hasVault: true,
  locked: false,
  network: "Starknet Sepolia",
  networkId: "SN_SEPOLIA",
  networks: [{ id: "SN_SEPOLIA", name: "Starknet Sepolia" }],
  ready: true,
});

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const unconfigured = (): PrivacyBlockerError =>
  new PrivacyBlockerError("network", "Private balances are not configured for this network");

const toastTexts = (): readonly (string | null)[] =>
  Array.from(document.querySelectorAll(".toast .toast-text")).map((node) => node.textContent);

// Mirrors the side panel: an account switch resets the privacy controller (a
// new generation and an empty disclosure) and the next paint binds again, which
// starts discovery for the newly selected account.
const switchingPanel = (load: () => Promise<never>) => {
  let disclosure: PrivacyDisclosureState = { error: null, loading: false, value: null };
  let generation = 0;
  let status = statusFor(account.id);
  let loads = 0;
  const app = document.createElement("main");
  document.body.append(app);
  const bind = (): void =>
    bindPrivacy({
      app,
      balances: () => [],
      disclosure: () => disclosure,
      generation: () => generation,
      journey: () => ({ stage: "idle" }),
      navigate: () => undefined,
      paint: () => undefined,
      preferences: () => preferences,
      setDisclosure: (state) => {
        disclosure = state;
      },
      setJourney: () => undefined,
      status: () => status,
      wallet: {
        loadPrivacyState: () => {
          loads += 1;
          return load();
        },
      } as unknown as SidepanelWallet,
    });
  return {
    bind,
    disclosure: () => disclosure,
    loads: () => loads,
    switchTo: async (accountId: string): Promise<void> => {
      generation += 1;
      disclosure = { error: null, loading: false, value: null };
      status = statusFor(accountId);
      bind();
      await tick();
    },
  };
};

const ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const token: TokenConfig = {
  address: ETH,
  decimals: 18,
  id: `SN_SEPOLIA:ETH:${ETH}`,
  name: "Ether",
  networkId: "SN_SEPOLIA",
  symbol: "ETH",
};

const networkBlocked: PrivacyDisclosureState = {
  blockerKind: "network",
  error: "Private balances are not configured for this network",
  loading: false,
  value: null,
};

describe("privacy notice on a network without a pool", () => {
  test("switching accounts A, B, A reads each account but never toasts", async () => {
    const panel = switchingPanel(async () => {
      throw unconfigured();
    });
    panel.bind();
    await tick();
    await panel.switchTo(secondAccount.id);
    await panel.switchTo(account.id);

    expect(panel.loads()).toBe(3);
    expect(panel.disclosure().blockerKind).toBe("network");
    expect(toastTexts()).toEqual([]);
  });

  test("a service failure on the same switches still toasts, once", async () => {
    const panel = switchingPanel(async () => {
      throw new Error("The privacy indexer is unavailable for this account.");
    });
    panel.bind();
    await tick();
    await panel.switchTo(secondAccount.id);

    expect(panel.loads()).toBe(2);
    expect(panel.disclosure().blockerKind).toBe("service");
    expect(toastTexts()).toEqual(["The privacy indexer is unavailable for this account."]);
  });

  test("the home portfolio states the network answer instead of offering a retry", () => {
    const html = homeTabs({ balances: [] }, null, {}, {}, "usd", networkBlocked);

    expect(html).toContain("Not available on this network");
    expect(html).not.toContain("data-privacy-retry");
    expect(html).not.toContain("Try again");
  });

  test("token detail states the network answer instead of offering a retry", () => {
    const html = tokenDetailFlow(statusFor(account.id), token, undefined, [], null, "usd", {
      ...networkBlocked,
    });

    expect(html).toContain("Not available on this network");
    expect(html).not.toContain("data-privacy-retry");
    expect(html).not.toContain("Try again");
  });
});

describe("toast stack", () => {
  test("does not stack a second copy of a toast already on screen", () => {
    showToast("The prover is offline.", "error", document);
    showToast("The prover is offline.", "error", document);
    showToast("The relay is offline.", "error", document);
    showToast("The prover is offline.", "warning", document);

    expect(document.querySelectorAll(".toast")).toHaveLength(3);
    expect(toastTexts()).toEqual([
      "The prover is offline.",
      "The relay is offline.",
      "The prover is offline.",
    ]);
  });
});
