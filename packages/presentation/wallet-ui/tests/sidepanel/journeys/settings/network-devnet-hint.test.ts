/**
 * Devnet is the one network whose node the user runs, and two of its
 * requirements are invisible until a write fails: the endpoint the wallet dials
 * and the chain id the write-path guard checks. The picker must state both while
 * devnet is selected, must state the endpoint actually in use rather than the
 * default, and must not nag on networks the wallet hosts itself.
 */
import { describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@mc-wallet/settings/preferences";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { WalletStatus } from "../../../../src/popup/responses/responses";
import { networkFlow } from "../../../../src/sidepanel/journeys/settings/network-views";

const DEFAULT_DEVNET_RPC = STARKNET_NETWORKS.SN_DEVNET.rpcUrls[0];
// The hint's own pointer to the recovery path. Asserting on "Advanced" alone is
// vacuous: the picker renders an "Advanced endpoints" row unconditionally.
const ADVANCED_NUDGE = "Set a custom RPC under Advanced";

const status = (networkId: StarknetNetworkId, network: string): WalletStatus => ({
  accountCount: 1,
  accounts: [],
  activeAccountId: null,
  hasVault: true,
  locked: false,
  network,
  networkId,
  networks: [
    { id: "SN_MAIN", name: "Starknet Mainnet" },
    { id: "SN_DEVNET", name: "Local Devnet" },
  ],
  ready: true,
});

const withDevnetOverride = (rpcUrl: string) => ({
  ...defaultWalletPreferences(),
  rpcOverrides: { SN_DEVNET: rpcUrl },
});

describe("network picker devnet hint", () => {
  test("names the default endpoint and the chain-id flag while devnet is selected", () => {
    const html = networkFlow(status("SN_DEVNET", "Local Devnet"), defaultWalletPreferences());
    expect(html).toContain(DEFAULT_DEVNET_RPC);
    expect(html).toContain("--chain-id SN_DEVNET");
    expect(html).toContain(ADVANCED_NUDGE);
  });

  test("names the configured override instead, and drops the nudge to set one", () => {
    const html = networkFlow(
      status("SN_DEVNET", "Local Devnet"),
      withDevnetOverride("http://127.0.0.1:5051/rpc"),
    );
    expect(html).toContain("http://127.0.0.1:5051/rpc");
    expect(html).toContain("--chain-id SN_DEVNET");
    // Telling a user to configure the override they are already using is noise.
    expect(html).not.toContain(ADVANCED_NUDGE);
  });

  test("stays silent on the hosted networks", () => {
    const html = networkFlow(status("SN_MAIN", "Starknet Mainnet"), defaultWalletPreferences());
    expect(html).not.toContain("--chain-id");
    expect(html).not.toContain(DEFAULT_DEVNET_RPC);
  });
});
