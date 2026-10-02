/**
 * NFT gallery operations dispatched from the background message handler: watch
 * a collectible after proving on-chain ownership, and send one through the
 * verification + invoke path. Removing and spam-hiding watched NFTs are plain
 * preference mutations handled in preference-ops.ts.
 */

import { buildErc721TransferCall, buildErc1155TransferCall } from "@bramble/portfolio/nft";
import { unavailableNftIndexer } from "@bramble/portfolio/nft-indexer";
import type { DiscoveredNft } from "@bramble/portfolio/nft-metadata";
import type { NftStandard } from "@bramble/starknet/rpc";
import { resolveFeeAffordability } from "@bramble/transactions/fee-funds";
import { refuseOnPoisonedRecipient, verifyCalls } from "@bramble/transactions/verify";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { signerForContext, verificationContext, type WalletOpsDeps } from "../accounts/wallet-ops";
import {
  activeAccountContext,
  networkRpcUrls,
  observedAccountContext,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization } from "../runtime/session";
import { recordSubmittedActivity } from "../transactions/activity-recording";
import { readStrkBalance } from "../transactions/fee-guard";
import { FEE_REVIEW_REQUIRED } from "../transactions/fee-review";
import { reviewWalletFundedFees } from "../transactions/transfer-fee-review";
import { withTrustedRecipients } from "../transactions/trusted-recipients";
import {
  type NftTarget,
  readAddNftInput,
  readDiscoverNftsInput,
  readLoadWatchedNftsInput,
  readReviewNftTransferInput,
  readTransferNftInput,
} from "./nft-inputs";
import { cachedNfts } from "./nft-snapshot-cache";

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
  const updated = await deps.preferencesStore.addNft({
    contract: input.contract,
    ...(input.label === undefined ? {} : { label: input.label }),
    networkId: input.networkId,
    owner: context.account.address,
    tokenId: input.tokenId,
  });
  await deps.nftSnapshots?.clear(context.account.id, context.networkId).catch(() => undefined);
  return { ok: true, preferences: updated };
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
  const preferences = await withTrustedRecipients(
    deps,
    await deps.preferencesStore.read(),
    context.accounts,
  );
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
  const fees = await reviewWalletFundedFees(deps.runtimeRpc, {
    account: context.account,
    calls: [call],
    rpcUrls,
    signHash: signerForContext(deps, context),
  });
  // Fee-affordability guard (issue 191): the NFT itself never spends STRK, so
  // only the estimate is compared against the balance. Warn-only, fail-open.
  const feeAffordability = resolveFeeAffordability({
    balance:
      fees.totalFee === null
        ? null
        : await readStrkBalance(deps, context.account, prepared.preferences),
    fee: fees.totalFee,
  });
  return {
    ok: true,
    review: {
      deploymentFee: fees.deploymentFee,
      deploymentFeeEstimateFailed: fees.deploymentFeeEstimateFailed,
      fee: fees.fee,
      feeAffordability,
      feeEstimateFailed: fees.feeEstimateFailed,
      // The target is an on-chain ownership-proven NFT contract, so the generic
      // "unknown token contract" warning is inapplicable. Recipient warnings
      // remain intact, including the submission-blocking poisoning check.
      flags: report.flags.filter((flag) => flag.code !== "unknown-contract"),
      requiresDeployment: fees.requiresDeployment,
      // Same DTO and renderer as the ERC-20 review: when the send also deploys
      // the account, a Ledger signs both, and the review says so here too.
      signsTwice: fees.requiresDeployment && context.account.derivation.kind === "ledger",
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
  const authorized = captureSessionAuthorization(deps.session);
  // Pre-sign verification through the one shared recipient policy: a recipient
  // that mimics a saved address is refused before anything is signed, in the
  // same words every other send line uses.
  const refusal = refuseOnPoisonedRecipient(report);
  if (refusal) {
    return refusal;
  }
  if (!input.reviewedFee) {
    return FEE_REVIEW_REQUIRED;
  }
  // Same bind as the ERC20 send: the fee the review step rendered is the
  // ceiling this send may sign under (MCW-V09-119).
  const result = await deps.runtimeRpc.submitInvokeTransaction({
    account: context.account,
    calls: [call],
    isAuthorized: authorized.isCurrent,
    ...(input.reviewedDeploymentFee ? { reviewedDeploymentFee: input.reviewedDeploymentFee } : {}),
    reviewedFee: input.reviewedFee,
    rpcUrls,
    signHash: signerForContext(deps, context),
  });
  await recordSubmittedActivity(deps.activity, {
    accountId: context.account.id,
    // The NFT's recipient is a payee like an ERC20 send's (audit #163).
    counterparty: input.recipient,
    hash: result.transactionHash,
    kind: "invoke",
    networkId: context.networkId,
    summary: report.calls[0]?.summary ?? `Send NFT #${input.tokenId}`,
  });
  await deps.nftSnapshots?.clear(context.account.id, context.networkId).catch(() => undefined);
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
  const accountId = input.multisigId ?? context.account.id;
  const hydrated = await cachedNfts(
    deps,
    {
      accountId,
      lane: input.includeWatched ? "complete" : "indexed",
      networkId: context.networkId,
    },
    async () => {
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
      // Indexer ownership remains untrusted: every fresh snapshot re-proves it.
      const owned = await filterOwnedNfts(deps, candidatesToVerify, owner, rpcUrls);
      // Unsolicited airdrops still never trigger attacker-controlled metadata.
      return input.includeWatched ? enrichWatchedNfts(deps, owned, watchedIds, rpcUrls) : owned;
    },
    input.cached,
  );
  return { nfts: hydrated, ok: true };
};

const handleLoadWatchedNfts = async (
  deps: WalletOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readLoadWatchedNftsInput(message);
  if (!input) {
    return { error: "invalid watched nft request" };
  }
  // Panel-poll traffic: observe the session, never extend it.
  const context = await observedAccountContext(deps.wallet, deps.session, deps.preferencesStore);
  if (context.error !== undefined) {
    return { error: context.error };
  }
  return {
    nfts: await cachedNfts(
      deps,
      { accountId: context.account.id, lane: "watched", networkId: context.networkId },
      async () => {
        const preferences = await deps.preferencesStore.read();
        return loadWatchedNfts(
          deps,
          preferences,
          context.networkId,
          context.account.address,
          networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
        );
      },
      input.cached,
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
