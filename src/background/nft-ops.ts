/**
 * NFT gallery operations dispatched from the background message handler: watch
 * a collectible after proving on-chain ownership, and send one through the
 * verification + invoke path. Removing and spam-hiding watched NFTs are plain
 * preference mutations handled in preference-ops.ts.
 */
import { STARKNET_NETWORKS } from "../starknet/networks";
import { buildErc721TransferCall, buildErc1155TransferCall } from "../starknet/nft";
import { unavailableNftIndexer } from "../starknet/nft-indexer";
import type { DiscoveredNft } from "../starknet/nft-metadata";
import type { NftStandard } from "../starknet/rpc";
import { verifyCalls } from "../starknet/verify";
import { readTypeOnlyInput } from "./message-inputs";
import { type NftTarget, readAddNftInput, readTransferNftInput } from "./nft-inputs";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { signerForContext, verificationContext, type WalletOpsDeps } from "./wallet-ops";

// Bounds how many on-chain ERC721 owner / ERC1155 balance re-proofs run at once
// during discovery.
// Candidates are already capped at the indexer boundary (MAX_DISCOVERED_NFTS);
// verifying them in fixed-size batches keeps the RPC fan-out bounded rather than
// firing one Promise.all across the whole list.
const OWNER_CHECK_CONCURRENCY = 5;

// Re-proves on-chain that the active account owns the target collectible and
// returns the detected transfer standard. The optional unified reader supports
// ERC1155; older test doubles fall back to their ERC721 owner reader.
const ownedNftStandard = async (
  deps: WalletOpsDeps,
  target: NftTarget,
  accountAddress: string,
  rpcUrls: readonly string[],
): Promise<NftStandard | null> => {
  if (deps.runtimeRpc.getNftOwnership) {
    const ownership = await deps.runtimeRpc.getNftOwnership({
      accountAddress,
      contractAddress: target.contract,
      rpcUrls,
      tokenId: target.tokenId,
    });
    return BigInt(ownership.balance) > 0n ? ownership.standard : null;
  }
  const owner = await deps.runtimeRpc.getNftOwner({
    contractAddress: target.contract,
    rpcUrls,
    tokenId: target.tokenId,
  });
  return BigInt(owner) === BigInt(accountAddress) ? "ERC721" : null;
};

// Re-proves ownership of one discovery candidate on-chain, returning the NFT
// when the active account still owns it and null when it does not or the read
// faults — the indexer's ownership claim is never trusted on its own.
const verifyOwnedNft = async (
  deps: WalletOpsDeps,
  nft: DiscoveredNft,
  accountAddress: string,
  rpcUrls: readonly string[],
): Promise<DiscoveredNft | null> => {
  try {
    const standard = await ownedNftStandard(
      deps,
      {
        contract: nft.contract,
        networkId: nft.networkId,
        tokenId: nft.tokenId,
      },
      accountAddress,
      rpcUrls,
    );
    return standard === null ? null : nft;
  } catch {
    return null;
  }
};

// Re-proves each candidate in fixed-size batches so the ownership-read fan-out
// stays bounded regardless of how many candidates the indexer returned,
// keeping only (and in original order) the tokens the active account still
// owns.
const filterOwnedNfts = async (
  deps: WalletOpsDeps,
  candidates: readonly DiscoveredNft[],
  accountAddress: string,
  rpcUrls: readonly string[],
): Promise<DiscoveredNft[]> => {
  const owned: DiscoveredNft[] = [];
  for (let start = 0; start < candidates.length; start += OWNER_CHECK_CONCURRENCY) {
    const batch = candidates.slice(start, start + OWNER_CHECK_CONCURRENCY);
    const verified = await Promise.all(
      batch.map((nft) => verifyOwnedNft(deps, nft, accountAddress, rpcUrls)),
    );
    owned.push(...verified.filter((nft): nft is DiscoveredNft => nft !== null));
  }
  return owned;
};

const watchedCandidates = (
  preferences: Awaited<ReturnType<WalletOpsDeps["preferencesStore"]["read"]>>,
  networkId: string,
): readonly DiscoveredNft[] =>
  (preferences.nfts ?? [])
    .filter((nft) => nft.networkId === networkId && nft.spam !== true)
    .map((nft) => ({
      collection: "",
      contract: nft.contract,
      id: nft.id,
      image: "",
      name: nft.label ?? "",
      networkId: nft.networkId,
      tokenId: nft.tokenId,
    }));

const mergeNftCandidates = (
  indexed: readonly DiscoveredNft[],
  watched: readonly DiscoveredNft[],
): readonly DiscoveredNft[] => {
  const merged = new Map(indexed.map((nft) => [nft.id, nft]));
  for (const nft of watched) {
    if (!merged.has(nft.id)) {
      merged.set(nft.id, nft);
    }
  }
  return [...merged.values()];
};

const enrichWatchedNft = async (
  deps: WalletOpsDeps,
  nft: DiscoveredNft,
  watchedIds: ReadonlySet<string>,
  rpcUrls: readonly string[],
): Promise<DiscoveredNft> => {
  if (!watchedIds.has(nft.id) || !deps.runtimeRpc.getNftMetadata) {
    return nft;
  }
  try {
    const metadata = await deps.runtimeRpc.getNftMetadata({
      contractAddress: nft.contract,
      rpcUrls,
      tokenId: nft.tokenId,
    });
    return metadata === null
      ? nft
      : {
          ...nft,
          attributes: metadata.attributes,
          collection: metadata.collection || nft.collection,
          description: metadata.description,
          externalUrl: metadata.externalUrl,
          image: metadata.image || nft.image,
          name: metadata.name || nft.name,
        };
  } catch {
    return nft;
  }
};

const enrichWatchedNfts = async (
  deps: WalletOpsDeps,
  owned: readonly DiscoveredNft[],
  watchedIds: ReadonlySet<string>,
  rpcUrls: readonly string[],
): Promise<DiscoveredNft[]> => {
  const enriched: DiscoveredNft[] = [];
  for (let start = 0; start < owned.length; start += OWNER_CHECK_CONCURRENCY) {
    const batch = owned.slice(start, start + OWNER_CHECK_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map((nft) => enrichWatchedNft(deps, nft, watchedIds, rpcUrls)),
    );
    enriched.push(...resolved);
  }
  return enriched;
};

const handleAddNft = async (deps: WalletOpsDeps, message: unknown): Promise<RuntimeResponse> => {
  const input = readAddNftInput(message);
  if (!input) {
    return { error: "invalid add nft request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  if (input.networkId !== context.networkId) {
    return { error: "switch to the NFT's network first" };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  const standard = await ownedNftStandard(deps, input, context.account.address, rpcUrls);
  if (standard === null) {
    return { error: "this account does not own that NFT" };
  }
  return {
    ok: true,
    preferences: await deps.preferencesStore.addNft({
      contract: input.contract,
      ...(input.label === undefined ? {} : { label: input.label }),
      networkId: input.networkId,
      tokenId: input.tokenId,
    }),
  };
};

const handleTransferNft = async (
  deps: WalletOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readTransferNftInput(message);
  if (!input) {
    return { error: "invalid transfer nft request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  if (input.networkId !== context.networkId) {
    return { error: "switch to the NFT's network first" };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  // Watched NFTs are not scoped to an account, so re-prove ownership for the
  // active account before signing rather than letting the ERC721/ERC1155
  // transfer revert on-chain (or, worse, submitting for the wrong account).
  const standard = await ownedNftStandard(deps, input, context.account.address, rpcUrls);
  if (standard === null) {
    return { error: "this account does not own that NFT" };
  }
  const call =
    standard === "ERC1155"
      ? buildErc1155TransferCall(
          input.contract,
          context.account.address,
          input.recipient,
          BigInt(input.tokenId),
        )
      : buildErc721TransferCall(
          input.contract,
          context.account.address,
          input.recipient,
          BigInt(input.tokenId),
        );
  const report = verifyCalls([call], verificationContext(context.account, preferences));
  // NFT sends now run through pre-sign verification: block a recipient that
  // mimics one of the wallet's saved addresses before anything is signed.
  const poisoning = report.flags.find((flag) => flag.code === "address-poisoning");
  if (poisoning) {
    return { error: poisoning.message };
  }
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: context.account,
    calls: [call],
    rpcUrls,
    signHash: signerForContext(deps, context),
  });
  await deps.activity.record({
    accountId: context.account.id,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: context.networkId,
    summary: report.calls[0]?.summary ?? `Send NFT #${input.tokenId}`,
  });
  return { ok: true, transactionHash: result.transactionHash };
};

const handleDiscoverNfts = async (
  deps: WalletOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.discoverNfts")) {
    return { error: "invalid discover nfts request" };
  }
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  const indexer = deps.runtimeRpc.nftIndexer ?? unavailableNftIndexer;
  const candidates = await indexer.listOwnedNfts({
    address: context.account.address,
    indexerUrl: preferences.nftIndexerUrl ?? null,
    networkId: context.networkId,
  });
  const watched = watchedCandidates(preferences, context.networkId);
  const watchedIds = new Set(watched.map((nft) => nft.id));
  // Never trust the indexer's ownership claim: re-prove each token through its
  // ERC721 owner or ERC1155 balance surface, dropping any the account no longer
  // owns (or that fail to read) so the gallery only shows verified holdings.
  const owned = await filterOwnedNfts(
    deps,
    mergeNftCandidates(candidates, watched),
    context.account.address,
    rpcUrls,
  );
  // Only explicitly watched NFTs resolve their token_uri/uri here. This preserves
  // the gallery's anti-tracking boundary: unsolicited airdrops never make the
  // extension contact an attacker-controlled metadata host in the background.
  const hydrated = await enrichWatchedNfts(deps, owned, watchedIds, rpcUrls);
  return { nfts: hydrated, ok: true };
};

/**
 * Handles NFT gallery messages; returns null for other message types.
 */
export const handleNftOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.addNft") {
    return handleAddNft(deps, message);
  }
  if (messageType === "wallet.transferNft") {
    return handleTransferNft(deps, message);
  }
  if (messageType === "wallet.discoverNfts") {
    return handleDiscoverNfts(deps, message);
  }
  return null;
};
