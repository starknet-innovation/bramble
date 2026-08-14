/**
 * Devnet is the one network whose node the user runs, and two of its
 * requirements are invisible until a write fails: the bundled endpoint and the
 * chain id the write-path guard checks. The picker must state both while devnet
 * is selected, and must not nag on networks the wallet hosts itself.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { networkFlow } from "../../../../src/sidepanel/journeys/settings/network-views";

const status = (networkId: string, network: string): WalletStatus => ({
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network,
  networkId: networkId as WalletStatus["networkId"],
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_DEVNET", name: "Local Devnet" },
  ],
  ready: true,
});

describe("network picker devnet hint", () => {
  test("names the endpoint and the chain-id flag while devnet is selected", () => {
    const html = networkFlow(status("SN_DEVNET", "Local Devnet"), defaultWalletPreferences());
    expect(html).toContain("127.0.0.1:5050");
    expect(html).toContain("--chain-id SN_DEVNET");
    // Recovery for a node running elsewhere lives one row below, in Advanced.
    expect(html).toContain("Advanced");
  });

  test("stays silent on the hosted networks", () => {
    const html = networkFlow(status("SN_MAIN", "Starknet Mainnet"), defaultWalletPreferences());
    expect(html).not.toContain("--chain-id");
    expect(html).not.toContain("127.0.0.1:5050");
  });
});
