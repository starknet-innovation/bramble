/**
 * Panel-side runtime wrappers for NFT discovery, preference mutations, review,
 * and transfer submission. Split from the main runtime client to keep the
 * asset boundary cohesive and both modules within the repository size budget.
 */
import {
  type DiscoveredNft,
  isDiscoverNftsResponse,
  isErrorResponse,
  isPreferencesResponse,
  isTransferResponse,
  isTransferReviewResponse,
  type TransferReviewResponse,
} from "../popup/responses";

const failure = (response: unknown, fallback: string): Error =>
  new Error(isErrorResponse(response) ? response.error : fallback);

/**
 * Builds the NFT wrappers over a runtime send function. Every reply is checked
 * before it reaches the UI; malformed replies fail closed or degrade to an
 * empty discovery list.
 */
export const createNftRuntimeClient = (sendMessage: (message: unknown) => Promise<unknown>) => ({
  async addNft(contract: string, tokenId: string, networkId: string, label: string): Promise<void> {
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
  },
  async discoverNfts(): Promise<readonly DiscoveredNft[]> {
    const response = await sendMessage({ type: "wallet.discoverNfts" });
    return isDiscoverNftsResponse(response) ? response.nfts : [];
  },
  async removeNft(id: string): Promise<void> {
    const response = await sendMessage({ id, type: "wallet.removeNft" });
    if (!isPreferencesResponse(response)) {
      throw failure(response, "remove NFT failed");
    }
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
  },
  async transferNft(
    contract: string,
    tokenId: string,
    networkId: string,
    recipient: string,
  ): Promise<string> {
    const response = await sendMessage({
      contract,
      networkId,
      recipient,
      tokenId,
      type: "wallet.transferNft",
    });
    if (isTransferResponse(response)) {
      return response.transactionHash;
    }
    throw failure(response, "NFT transfer failed");
  },
});
