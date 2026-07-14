/**
 * NFT gallery operations dispatched from the background message handler: watch
 * a collectible after proving on-chain ownership, and send one through the
 * verification + invoke path. Removing and spam-hiding watched NFTs are plain
 * preference mutations handled in preference-ops.ts.
 */
import { STARKNET_NETWORKS } from "../starknet/networks";
import { buildErc721TransferCall } from "../starknet/nft";
import { unavailableNftIndexer } from "../starknet/nft-indexer";
import type { DiscoveredNft } from "../starknet/nft-metadata";
import { verifyCalls } from "../starknet/verify";
import { readTypeOnlyInput } from "./message-inputs";
import { readAddNftInput, readTransferNftInput } from "./nft-inputs";
import { activeAccountContext, networkRpcUrls } from "./runtime-state";
import type { RuntimeResponse } from "./runtime-types";
import { signerForContext, verificationContext, type WalletOpsDeps } from "./wallet-ops";

/**
 * Handles NFT gallery messages; returns null for other message types.
 */
export const handleNftOps = async (
  deps: WalletOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  if (messageType === "wallet.addNft") {
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
    const owner = await deps.runtimeRpc.getNftOwner({
      contractAddress: input.contract,
      rpcUrls: networkRpcUrls(STARKNET_NETWORKS[context.networkId], preferences),
      tokenId: input.tokenId,
    });
    if (BigInt(owner) !== BigInt(context.account.address)) {
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
  }

  if (messageType === "wallet.transferNft") {
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
    // active account before signing rather than letting transfer_from revert
    // on-chain (or, worse, submitting for the wrong account).
    const owner = await deps.runtimeRpc.getNftOwner({
      contractAddress: input.contract,
      rpcUrls,
      tokenId: input.tokenId,
    });
    if (BigInt(owner) !== BigInt(context.account.address)) {
      return { error: "this account does not own that NFT" };
    }
    const call = buildErc721TransferCall(
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
  }

  if (messageType === "wallet.discoverNfts") {
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
    // Never trust the indexer's ownership claim: re-prove each token on-chain
    // with the same owner_of check the manual watch flow uses, dropping any the
    // account no longer owns (or that fail to read) so the gallery only ever
    // shows verified holdings.
    const verified = await Promise.all(
      candidates.map(async (nft): Promise<DiscoveredNft | null> => {
        try {
          const owner = await deps.runtimeRpc.getNftOwner({
            contractAddress: nft.contract,
            rpcUrls,
            tokenId: nft.tokenId,
          });
          return BigInt(owner) === BigInt(context.account.address) ? nft : null;
        } catch {
          return null;
        }
      }),
    );
    const owned = verified.filter((nft): nft is DiscoveredNft => nft !== null);
    return { nfts: owned, ok: true };
  }

  return null;
};
