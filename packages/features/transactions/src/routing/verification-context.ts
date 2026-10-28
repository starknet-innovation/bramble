/**
 * The wallet context the pre-sign reviewer checks calls against, and the one
 * builder that scopes it to an account's network. Split from ./verify-decode to
 * keep each file within the size budget; ./verify-decode re-exports both, so
 * import paths are unchanged.
 */

import { isCuratedToken, isLikelySpam } from "@bramble/portfolio/token-registry";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import type { AddressBookEntry, TokenConfig } from "@bramble/wallet-model/preferences";

/**
 * Wallet context the verifier checks calls against: the acting account, the
 * contacts and tokens it trusts, and the NFT collections it watches. The
 * collection list is what lets an ERC721 `approve(to, token_id)` be told apart
 * from an ERC20 `approve(spender, amount)` — the two are indistinguishable by
 * calldata alone.
 */
export type VerificationContext = {
  readonly account: Pick<AccountRef, "address" | "networkId">;
  readonly addressBook: readonly AddressBookEntry[];
  /** Wallet-pinned application contracts that should not raise an unknown-contract warning. */
  readonly knownContracts?: readonly string[];
  /**
   * Collections this account watches. Optional because a context can be built
   * where the wallet holds no NFT knowledge at all; absent means "no collection
   * is known", under which an ERC721 `approve` is indistinguishable from an
   * ERC20 one and is described in ERC20 terms. Every production context comes
   * from {@link verificationContext}, which always fills it in.
   */
  readonly nftContracts?: readonly string[];
  /**
   * The user's other wallet accounts and watched shared accounts on this
   * network. Optional: absent means only `account` is known as the user's own.
   */
  readonly ownAccounts?: readonly string[];
  /**
   * Recipients this wallet itself has paid on this network (wallet-origin
   * activity only, never chain-discovered rows). Optional: absent means no
   * payment history is consulted.
   */
  readonly recentRecipients?: readonly string[];
  readonly tokens: readonly TokenConfig[];
};

type NetworkScopedAddress = {
  readonly address: string;
  readonly networkId: StarknetNetworkId;
};

const addressesOn = (
  entries: readonly NetworkScopedAddress[] | undefined,
  networkId: StarknetNetworkId,
): readonly string[] =>
  (entries ?? []).filter((entry) => entry.networkId === networkId).map((entry) => entry.address);

/**
 * Builds the wallet context the verifier checks calls against, scoped to the
 * account's network.
 *
 * This is the single definition of "which contacts, tokens, and collections does
 * this account trust". It lives beside the verifier rather than in one product
 * line's handler so the ERC20 send, the NFT send, the allowance flows, the swap,
 * the dapp invoke, and the privacy pool routes all scope the trusted set the
 * same way; a fourth local copy of these filters is how a contact saved on
 * another network once made a foreign recipient read as trusted. Pure — it only
 * filters the preferences it is handed and never reads storage itself; the
 * optional own-account and paid-recipient lists are network-filtered here too.
 */
export const verificationContext = (
  account: Pick<AccountRef, "address" | "networkId">,
  preferences: {
    readonly addressBook: readonly AddressBookEntry[];
    /** Ids of dapp-added tokens (wallet_watchAsset) the user never added themselves. */
    readonly dappTokenIds?: readonly string[];
    // Structurally typed rather than importing `WatchedNft` from the
    // portfolio package: only these two fields are read, and a `WatchedNft`
    // still satisfies the shape at every call site.
    readonly nfts?: readonly { readonly contract: string; readonly networkId: StarknetNetworkId }[];
    // Background-derived trust sources (see the background's
    // `withTrustedRecipients`); absent on contexts built without them.
    readonly ownAccounts?: readonly NetworkScopedAddress[];
    readonly paidRecipients?: readonly NetworkScopedAddress[];
    readonly tokens: readonly TokenConfig[];
  },
): VerificationContext => ({
  account,
  addressBook: preferences.addressBook.filter((entry) => entry.networkId === account.networkId),
  nftContracts: (preferences.nfts ?? [])
    .filter((nft) => nft.networkId === account.networkId)
    .map((nft) => nft.contract),
  ownAccounts: addressesOn(preferences.ownAccounts, account.networkId),
  recentRecipients: addressesOn(preferences.paidRecipients, account.networkId),
  tokens: trustedTokens(preferences).filter((token) => token.networkId === account.networkId),
});

/**
 * Every tracked token the wallet trusts, on every network — the same rule
 * {@link verificationContext} applies per account (see `isTrustedToken`).
 * Read by allowance eviction, which ranks the whole log across networks.
 */
export const trustedTokens = (preferences: {
  readonly dappTokenIds?: readonly string[];
  readonly tokens: readonly TokenConfig[];
}): readonly TokenConfig[] =>
  preferences.tokens.filter((token) => isTrustedToken(token, preferences.dappTokenIds ?? []));

// A tracked token that trips the spam heuristic (a ticker borrowed from a
// different contract, malformed metadata) is not trusted, and neither is one a
// dapp added unless it is exactly a curated token: the spam heuristic only
// knows the curated tickers (none on Sepolia or devnet), so a site-named token
// would otherwise lend its ticker and decimals anywhere else (audit 171). An
// untrusted token stays an unknown contract and its calls are summarized in raw
// units. User-added and curated tokens stay trusted; `hiddenTokens` is
// deliberately not consulted, so a user hiding STRK changes nothing here.
const isTrustedToken = (token: TokenConfig, dappTokenIds: readonly string[]): boolean =>
  !isLikelySpam(token) && (!dappTokenIds.includes(token.id) || isCuratedToken(token));
