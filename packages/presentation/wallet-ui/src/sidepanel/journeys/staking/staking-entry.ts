/**
 * Whether a token's detail screen offers "Stake" (issue 750). Decided from
 * what the wallet already holds, with no network call on the token screen:
 * staking must be switched on for the network, and the token must be STRK or
 * a token the staking screen has already read on chain for this account. Rows
 * exist only for tokens the staking contract's `get_active_tokens` lists, so a
 * BTC token shows "Stake" once staking has seen it. The staking screen does
 * its own on-chain check either way; this only decides where the entry shows.
 */
import { stakingNetwork } from "@bramble/transactions/staking-networks";
import {
  STRK_TOKEN_ADDRESS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import type { StakingState } from "./staking-directory-client";

/**
 * True when the token screen should offer "Stake" for `token`. Pure.
 */
export const canStakeToken = (
  networkId: StarknetNetworkId,
  token: { readonly address: string; readonly id: string },
  staking: StakingState,
): boolean => {
  if (!stakingNetwork(networkId)) return false;
  if (sameFelt(token.address, STRK_TOKEN_ADDRESS)) return true;
  const rows = [
    ...("rows" in staking.validator ? staking.validator.rows : []),
    ...("rows" in staking.positions ? staking.positions.rows : []),
  ];
  return rows.some((row) => row.tokenId === token.id);
};
