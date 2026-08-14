/**
 * Panel-side runtime wrappers for NFT discovery, preference mutations, review,
 * and transfer submission. Split from the main runtime client to keep the
 * asset boundary cohesive and both modules within the repository size budget.
 */
import {
  type DiscoveredNft,
  isDiscoverNftsResponse,
  isPreferencesResponse,
  isTransferResponse,
  isTransferReviewResponse,
  type TransferReviewResponse,
} from "../../../popup/responses/responses";
import { responseError as failure } from "../../runtime/runtime-errors";

/**
 * Builds the NFT wrappers over a runtime send function. Every reply is checked
 * before it reaches the UI; malformed replies fail closed or degrade to an
 * empty discovery list.
 */
export const createNftRuntimeClient = (sendMessage: (message: unknown) => Promise<unknown>) => {
  const inFlightLoads = new Map<string, Promise<readonly DiscoveredNft[]>>();
  const loadNfts = (
    key: string,
    message: Readonly<Record<string, unknown>>,
  ): Promise<readonly DiscoveredNft[]> => {
    const running = inFlightLoads.get(key);
    if (running) {
      return running;
    }
    const load = sendMessage(message)
      .then((response) => (isDiscoverNftsResponse(response) ? response.nfts : []))
      .finally(() => {
        if (inFlightLoads.get(key) === load) {
          inFlightLoads.delete(key);
        }
      });
    inFlightLoads.set(key, load);
    return load;
  };

  return {
    async addNft(
      contract: string,
      tokenId: string,
      networkId: string,
      label: string,
    ): Promise<void> {
      const response = await sendMessage({
        contract,
        ...(label ? { label } : {}),
        networkId,
        tokenId,
        type: "wallet.addNft",
      });
      if (!isPreferencesResponse(response)) {
        throw failure(response, "add NFT failed");
      }
      inFlightLoads.clear();
    },
    async discoverNfts(
      includeWatched = true,
      scopeKey = "current",
      multisigId?: string,
    ): Promise<readonly DiscoveredNft[]> {
      return loadNfts(`discover:${scopeKey}:${includeWatched}:${multisigId ?? "account"}`, {
        ...(includeWatched ? {} : { includeWatched: false }),
        ...(multisigId ? { multisigId } : {}),
        type: "wallet.discoverNfts",
      });
    },
    async loadWatchedNfts(scopeKey = "current"): Promise<readonly DiscoveredNft[]> {
      return loadNfts(`watched:${scopeKey}`, { type: "wallet.loadWatchedNfts" });
    },
    async removeNft(id: string): Promise<void> {
      const response = await sendMessage({ id, type: "wallet.removeNft" });
      if (!isPreferencesResponse(response)) {
        throw failure(response, "remove NFT failed");
      }
      inFlightLoads.clear();
    },
    async reviewNftTransfer(
      contract: string,
      tokenId: string,
      networkId: string,
      recipient: string,
    ): Promise<TransferReviewResponse["review"]> {
      const response = await sendMessage({
        contract,
        networkId,
        recipient,
        tokenId,
        type: "wallet.reviewNftTransfer",
      });
      if (isTransferReviewResponse(response)) {
        return response.review;
      }
      throw failure(response, "NFT transfer review failed");
    },
    async setNftSpam(id: string, spam: boolean): Promise<void> {
      const response = await sendMessage({ id, spam, type: "wallet.setNftSpam" });
      if (!isPreferencesResponse(response)) {
        throw failure(response, "NFT update failed");
      }
      inFlightLoads.clear();
    },
    async setNftIndexerUrl(url: string): Promise<void> {
      const response = await sendMessage({ type: "wallet.setNftIndexerUrl", url });
      if (!isPreferencesResponse(response)) {
        throw failure(response, "indexer endpoint update failed");
      }
      inFlightLoads.clear();
    },
    /**
     * Sends the reviewed NFT under its exact invoke and optional deployment
     * fee ceilings. A missing required ceiling is refused before signing.
     */
    async transferNft(
      contract: string,
      tokenId: string,
      networkId: string,
      recipient: string,
      reviewedFee: TransferReviewResponse["review"]["fee"] = null,
      reviewedDeploymentFee: TransferReviewResponse["review"]["deploymentFee"] = null,
    ): Promise<string> {
      const response = await sendMessage({
        contract,
        networkId,
        recipient,
        ...(reviewedDeploymentFee == null ? {} : { reviewedDeploymentFee }),
        ...(reviewedFee === null ? {} : { reviewedFee }),
        tokenId,
        type: "wallet.transferNft",
      });
      if (isTransferResponse(response)) {
        inFlightLoads.clear();
        return response.transactionHash;
      }
      throw failure(response, "NFT transfer failed");
    },
  };
};
