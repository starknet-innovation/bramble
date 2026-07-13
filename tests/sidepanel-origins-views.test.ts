/**
 * Connected-sites UI checks: the settings menu links to the flow, the flow
 * lists granted origins with revoke controls and back navigation, the approval
 * card renders reputation insights prominently, and the response validators
 * accept the connected-sites and enriched pending-approval shapes.
 */
import { describe, expect, test } from "bun:test";
import {
  isConnectedSitesResponse,
  isPendingApprovalsResponse,
  type WalletStatus,
} from "../src/popup/responses";
import { dashboard } from "../src/sidepanel/views";
import { account, preferences } from "./support/sidepanel-fixtures";

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

const approvalId = "b81c5dd1-53ff-4b7b-a171-0f0a08e0ff14";
const sites = [{ accountCount: 1, origin: "https://dapp.example" }];

describe("connected-sites views", () => {
  test("settings links to the connected-sites flow", () => {
    const html = dashboard("settings", status, [], preferences, { balances: [] });
    expect(html).toMatch(/menu-row" data-view="connected-sites"/);
  });

  test("connected-sites flow lists origins with revoke controls and back nav", () => {
    const html = dashboard(
      "connected-sites",
      status,
      [],
      preferences,
      { balances: [] },
      null,
      [],
      sites,
    );

    expect(html).toContain('id="wallet-screen-connected-sites"');
    expect(html).toContain("https://dapp.example");
    expect(html).toContain('data-revoke-origin="https://dapp.example"');
    expect(html).toContain("1 account shared");
    expect(html).toMatch(/data-view="settings"[^>]*aria-label="Back"/);
    expect(html).not.toContain("wallet-dock");
  });

  test("connected-sites flow shows an empty state with no grants", () => {
    const html = dashboard(
      "connected-sites",
      status,
      [],
      preferences,
      { balances: [] },
      null,
      [],
      [],
    );
    expect(html).toContain("No sites are connected yet");
    expect(html).not.toContain("data-revoke-origin");
  });

  test("approval card renders reputation insights prominently", () => {
    const pending = [
      {
        blocked: false,
        id: approvalId,
        insights: ["Domain closely resembles starknet.io; watch for a spoofed lookalike."],
        origin: "https://st4rknet.io",
      },
    ];
    const html = dashboard("activity", status, pending, preferences, { balances: [] });

    expect(html).toContain("resembles starknet.io");
    expect(html).toContain('class="review-flag"');
  });

  test("approval card disables approve for a blocked origin", () => {
    const pending = [
      {
        blocked: true,
        id: approvalId,
        insights: ["This domain is on the wallet blocklist of known phishing and scam sites."],
        origin: "https://starknet-airdrop.com",
      },
    ];
    const html = dashboard("activity", status, pending, preferences, { balances: [] });
    expect(html).toMatch(/data-approval-action="approve"[^>]*disabled/);
  });
});

describe("connected-sites response validators", () => {
  test("accepts a well-formed connected-sites response", () => {
    expect(isConnectedSitesResponse({ ok: true, sites })).toBe(true);
    expect(isConnectedSitesResponse({ ok: true, sites: [] })).toBe(true);
  });

  test("rejects malformed connected-sites responses", () => {
    expect(
      isConnectedSitesResponse({
        ok: true,
        sites: [{ accountCount: -1, origin: "https://d.example" }],
      }),
    ).toBe(false);
    expect(
      isConnectedSitesResponse({
        ok: true,
        sites: [{ accountCount: 1, origin: "http://d.example" }],
      }),
    ).toBe(false);
    expect(
      isConnectedSitesResponse({
        ok: true,
        sites: [
          { accountCount: 1, origin: "https://d.example" },
          { accountCount: 2, origin: "https://d.example" },
        ],
      }),
    ).toBe(false);
    expect(
      isConnectedSitesResponse({
        ok: true,
        sites: [{ accountCount: 1, label: "x", origin: "https://d.example" }],
      }),
    ).toBe(false);
  });

  test("accepts pending approvals enriched with insights and rejects bad insights", () => {
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [
          {
            blocked: false,
            id: approvalId,
            insights: ["First time seen."],
            origin: "https://d.example",
          },
        ],
      }),
    ).toBe(true);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ blocked: false, id: approvalId, insights: [""], origin: "https://d.example" }],
      }),
    ).toBe(false);
    expect(
      isPendingApprovalsResponse({
        ok: true,
        pending: [{ blocked: "no", id: approvalId, origin: "https://d.example" }],
      }),
    ).toBe(false);
  });
});
