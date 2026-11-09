/**
 * The connected-sites screen only claims "no sites are connected" from an
 * answer (Sherlock 234).
 *
 * The runtime used to map any unreadable reply to an empty list and the cache
 * started empty, so a failed or not-yet-landed read rendered "0 connected",
 * the empty-state claim, and no revoke controls. A failed read now shows the
 * failure with a retry, and an unread list shows that it is loading.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ConnectedSite, WalletStatus } from "../../../../src/popup/responses/responses";
import { emptyRenderCache } from "../../../../src/sidepanel/app/rendering/render-cache";
import { connectedSitesFlow } from "../../../../src/sidepanel/app/screens/support-flows";
import { hydrateView } from "../../../../src/sidepanel/app/sync/hydrate";
import type { SidepanelWallet } from "../../../../src/sidepanel/runtime/runtime";
import { registerDom, unregisterDom } from "../../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

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
const site: ConnectedSite = { accountCount: 1, origin: "https://example.com" } as ConnectedSite;
const EMPTY_CLAIM = "No sites are connected yet";

const render = (markup: string): HTMLElement => {
  const host = document.createElement("div");
  host.replaceChildren(document.createRange().createContextualFragment(markup));
  return host;
};

describe("connected sites screen", () => {
  test("shows a failed read as a failure with a retry, never as no sites", () => {
    const screen = render(connectedSitesFlow(status, "error"));
    expect(screen.textContent).toContain("Couldn't load connected sites.");
    expect(screen.textContent).not.toContain(EMPTY_CLAIM);
    expect(screen.textContent).not.toContain("0 connected");
    expect(screen.querySelector("[data-reload-balances]")).not.toBeNull();
  });

  test("shows an unread list as loading, never as no sites", () => {
    const screen = render(connectedSitesFlow(status, "loading"));
    expect(screen.textContent).toContain("Loading connected sites…");
    expect(screen.textContent).not.toContain(EMPTY_CLAIM);
    expect(screen.textContent).not.toContain("0 connected");
  });

  test("still lists the sites with revoke controls, and the empty claim from an answer", () => {
    const listed = render(connectedSitesFlow(status, [site]));
    expect(listed.textContent).toContain("1 connected");
    expect(listed.querySelector('[data-revoke-origin="https://example.com"]')).not.toBeNull();
    expect(render(connectedSitesFlow(status, [])).textContent).toContain(EMPTY_CLAIM);
  });
});

// Any method the connected-sites view does not need rejects, as an
// unavailable background would.
const walletWith = (connectedSites: SidepanelWallet["connectedSites"]): SidepanelWallet =>
  new Proxy({ connectedSites } as Record<string, unknown>, {
    get: (target, key) =>
      key in target ? target[key as string] : () => Promise.reject(new Error("unavailable")),
  }) as unknown as SidepanelWallet;

const hydrateSites = (cache: ReturnType<typeof emptyRenderCache>, wallet: SidepanelWallet) =>
  hydrateView({
    activeView: "connected-sites",
    cache,
    deployment: { load: async () => null },
    multisig: { loadMultisigs: async () => ({ intents: [], multisigs: [] }) },
    paint: () => undefined,
    selectedMultisigId: null,
    selectedTokenId: null,
    signability: { load: async () => null },
    status,
    wallet,
  } as never);

describe("connected sites hydration", () => {
  test("records a failed first read as an error", async () => {
    const cache = emptyRenderCache();
    await hydrateSites(
      cache,
      walletWith(() => Promise.reject(new Error("connected sites unavailable"))),
    );
    expect(cache.connectedSites).toBe("error");
  });

  test("keeps a list already shown when a later read fails", async () => {
    const cache = emptyRenderCache();
    await hydrateSites(
      cache,
      walletWith(async () => [site]),
    );
    expect(cache.connectedSites).toEqual([site]);
    await hydrateSites(
      cache,
      walletWith(() => Promise.reject(new Error("connected sites unavailable"))),
    );
    expect(cache.connectedSites).toEqual([site]);
  });
});
