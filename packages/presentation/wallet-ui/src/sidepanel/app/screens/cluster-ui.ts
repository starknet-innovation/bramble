/**
 * Wiring for the token, allowance, NFT, and connected-sites cluster screens.
 * Extracted from the side panel entrypoint to keep it within the size budget;
 * navigation side effects are passed in as callbacks so this module holds no
 * module-level state.
 */
import type { WalletStatus } from "../../../popup/responses/responses";
import { bindNfts } from "../../journeys/collectibles/nft-ui";
import { bindAllowances } from "../../journeys/portfolio/allowance-ui";
import { bindTokens } from "../../journeys/portfolio/tokens-ui";
import { bindConnectedSites } from "../../journeys/settings/origins-ui";
import type { SidepanelWallet } from "../../runtime/runtime";

/**
 * Callbacks and context the cluster screen bindings close over.
 */
export type ClusterUiDeps = {
  readonly app: Element | null;
  readonly openNft: (id: string) => void;
  readonly openToken: (tokenId: string) => void;
  readonly render: (status: WalletStatus) => Promise<void>;
  readonly wallet: SidepanelWallet;
};

/**
 * Binds the connected-sites, tokens, allowances, and NFT cluster screens.
 */
export const bindClusterScreens = (deps: ClusterUiDeps): void => {
  const { app, render, wallet } = deps;
  bindConnectedSites({ app, render, wallet });
  bindTokens({
    app,
    openToken: deps.openToken,
    refresh: () => wallet.loadStatus(),
    render,
    wallet,
  });
  bindAllowances({ app, render, wallet });
  bindNfts({ app, openDetail: deps.openNft, render, wallet });
};
