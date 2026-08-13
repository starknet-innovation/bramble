/**
 * NFT gallery operations dispatched from the background message handler: watch
 * a collectible after proving on-chain ownership, and send one through the
 * verification + invoke path. Removing and spam-hiding watched NFTs are plain
 * preference mutations handled in preference-ops.ts.
 */

import { buildErc721TransferCall, buildErc1155TransferCall } from "@mc-wallet/portfolio/nft";
import { unavailableNftIndexer } from "@mc-wallet/portfolio/nft-indexer";
import type { DiscoveredNft } from "@mc-wallet/portfolio/nft-metadata";
import type { NftStandard } from "@mc-wallet/starknet/rpc";
import { resolveFeeAffordability } from "@mc-wallet/transactions/fee-funds";
import { refuseOnPoisonedRecipient, verifyCalls } from "@mc-wallet/transactions/verify";
import { STARKNET_NETWORKS, sameFelt } from "@mc-wallet/wallet-model/networks";
import {
  resolveReviewFee,
  signerForContext,
  verificationContext,
  type WalletOpsDeps,
} from "../accounts/wallet-ops";
import { readTypeOnlyInput } from "../routing/message-inputs";
import {
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { readStrkBalance } from "../transactions/fee-guard";
import {
  type NftTarget,
  readAddNftInput,
  readDiscoverNftsInput,
  readReviewNftTransferInput,
  readTransferNftInput,
} from "./nft-inputs";

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
  return sameFelt(owner, accountAddress) ? "ERC721" : null;
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
  ownerAddress: string,
): readonly DiscoveredNft[] =>
  (preferences.nfts ?? [])
    .filter(
      (nft) =>
        nft.networkId === networkId &&
        nft.spam !== true &&
        (nft.owner === undefined || sameFelt(nft.owner, ownerAddress)),
    )
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
          ...(metadata.animationUrl ? { animationUrl: metadata.animationUrl } : {}),
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

const loadWatchedNfts = async (
  deps: WalletOpsDeps,
  preferences: Awaited<ReturnType<WalletOpsDeps["preferencesStore"]["read"]>>,
  networkId: string,
  accountAddress: string,
  rpcUrls: readonly string[],
): Promise<DiscoveredNft[]> => {
  const watched = watchedCandidates(preferences, networkId, accountAddress);
  const owned = await filterOwnedNfts(deps, watched, accountAddress, rpcUrls);
  return enrichWatchedNfts(deps, owned, new Set(watched.map((nft) => nft.id)), rpcUrls);
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
      owner: context.account.address,
      tokenId: input.tokenId,
    }),
  };
};

type NftTransferInput = NonNullable<ReturnType<typeof readTransferNftInput>>;

// Resolves the active account, re-proves ownership, detects the transfer
// standard, builds the exact call, and verifies it. Both review and submission
// use this boundary so the confirmed request cannot drift from review logic.
const prepareNftTransfer = async (deps: WalletOpsDeps, input: NftTransferInput) => {
  const context = await activeAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error } as const;
  }
  if (input.networkId !== context.networkId) {
    return { error: "switch to the NFT's network first" } as const;
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  // Watched NFTs are not scoped to an account, so both review and confirmation
  // prove ownership for the active account instead of trusting gallery state.
  const standard = await ownedNftStandard(deps, input, context.account.address, rpcUrls);
  if (standard === null) {
    return { error: "this account does not own that NFT" } as const;
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
  return { call, context, preferences, report, rpcUrls } as const;
};

const handleReviewNftTransfer = async (
  deps: WalletOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readReviewNftTransferInput(message);
  if (!input) {
    return { error: "invalid nft transfer review request" };
  }
  const prepared = await prepareNftTransfer(deps, input);
  if ("error" in prepared) {
    return { error: prepared.error };
  }
  const { call, context, report, rpcUrls } = prepared;
  const deployed = await deps.runtimeRpc
    .getDeploymentStatus({ accountAddress: context.account.address, rpcUrls })
    .catch(() => true);
  const estimated = deployed
    ? await deps.runtimeRpc
        .estimateInvokeFee({
          account: context.account,
          calls: [call],
          rpcUrls,
          signHash: signerForContext(deps, context),
        })
        .catch(() => null)
    : null;
  const { fee, feeEstimateFailed } = resolveReviewFee({ deployed, fee: estimated });
  // Fee-affordability guard (issue 191): the NFT itself never spends STRK, so
  // only the estimate is compared against the balance. Warn-only, fail-open.
  const feeAffordability = resolveFeeAffordability({
    balance:
      fee === null ? null : await readStrkBalance(deps, context.account, prepared.preferences),
    fee,
  });
  return {
    ok: true,
    review: {
      fee,
      feeAffordability,
      feeEstimateFailed,
      // The target is an on-chain ownership-proven NFT contract, so the generic
      // "unknown token contract" warning is inapplicable. Recipient warnings
      // remain intact, including the submission-blocking poisoning check.
      flags: report.flags.filter((flag) => flag.code !== "unknown-contract"),
      requiresDeployment: !deployed,
      summaries: report.calls.map((decoded) => decoded.summary),
    },
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
  const prepared = await prepareNftTransfer(deps, input);
  if ("error" in prepared) {
    return { error: prepared.error };
  }
  const { call, context, report, rpcUrls } = prepared;
  // Pre-sign verification through the one shared recipient policy: a recipient
  // that mimics a saved address is refused before anything is signed, in the
  // same words every other send line uses.
  const refusal = refuseOnPoisonedRecipient(report);
  if (refusal) {
    return refusal;
  }
  // Same bind as the ERC20 send: the fee the review step rendered is the
  // ceiling this send may sign under (MCW-V09-119).
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: context.account,
    calls: [call],
    ...(input.reviewedFee ? { reviewedFee: input.reviewedFee } : {}),
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
  const input = readDiscoverNftsInput(message);
  if (!input) {
    return { error: "invalid discover nfts request" };
  }
  // Panel-poll traffic: observe the session, never extend it.
  const context = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const watchedMultisig =
    input.multisigId === undefined || !deps.multisigStore
      ? undefined
      : (await deps.multisigStore.listMultisigs()).find(
          (record) => record.id === input.multisigId && record.networkId === context.networkId,
        );
  const owner = input.multisigId === undefined ? context.account.address : watchedMultisig?.address;
  if (owner === undefined) {
    return { error: "multisig not found on the active network" };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  const indexer = deps.runtimeRpc.nftIndexer ?? unavailableNftIndexer;
  const candidates = await indexer.listOwnedNfts({
    address: owner,
    indexerUrl: preferences.nftIndexerUrl ?? null,
    networkId: context.networkId,
  });
  const watched = watchedCandidates(preferences, context.networkId, owner);
  const watchedIds = new Set(watched.map((nft) => nft.id));
  const candidatesToVerify = input.includeWatched
    ? mergeNftCandidates(candidates, watched)
    : candidates.filter((nft) => !watchedIds.has(nft.id));
  // Never trust the indexer's ownership claim: re-prove each token through its
  // ERC721 owner or ERC1155 balance surface, dropping any the account no longer
  // owns (or that fail to read) so the gallery only shows verified holdings.
  const owned = await filterOwnedNfts(deps, candidatesToVerify, owner, rpcUrls);
  // Only explicitly watched NFTs resolve their token_uri/uri here. This preserves
  // the gallery's anti-tracking boundary: unsolicited airdrops never make the
  // extension contact an attacker-controlled metadata host in the background.
  const hydrated = input.includeWatched
    ? await enrichWatchedNfts(deps, owned, watchedIds, rpcUrls)
    : owned;
  return { nfts: hydrated, ok: true };
};

const handleLoadWatchedNfts = async (
  deps: WalletOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  if (!readTypeOnlyInput(message, "wallet.loadWatchedNfts")) {
    return { error: "invalid watched nft request" };
  }
  // Panel-poll traffic: observe the session, never extend it.
  const context = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences);
  return {
    nfts: await loadWatchedNfts(
      deps,
      preferences,
      context.networkId,
      context.account.address,
      rpcUrls,
    ),
    ok: true,
  };
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
  if (messageType === "wallet.reviewNftTransfer") {
    return handleReviewNftTransfer(deps, message);
  }
  if (messageType === "wallet.transferNft") {
    return handleTransferNft(deps, message);
  }
  if (messageType === "wallet.discoverNfts") {
    return handleDiscoverNfts(deps, message);
  }
  if (messageType === "wallet.loadWatchedNfts") {
    return handleLoadWatchedNfts(deps, message);
  }
  return null;
};
