/**
 * The two NFT transfer routes in the key-boundary scan catalog: the review that
 * prices a transfer and the submission that signs it. Both reach the signing
 * path, so both must be scanned for leaked secret material.
 *
 * Split out of `key-boundary-messages.ts` so that file stays within the size
 * budget; the entries are spread back in at their original position, so the
 * suite's scan order is unchanged.
 */

import {
  extensionSender,
  KEY_BOUNDARY_NFT_CONTRACT,
  KEY_BOUNDARY_RECIPIENT,
} from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/** Review-then-submit pair for an NFT transfer. */
export const NFT_TRANSFER_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  {
    message: {
      contract: KEY_BOUNDARY_NFT_CONTRACT,
      networkId: "SN_MAIN",
      recipient: KEY_BOUNDARY_RECIPIENT,
      tokenId: "1",
      type: "wallet.reviewNftTransfer",
    },
    sender: extensionSender,
  },
  {
    message: {
      contract: KEY_BOUNDARY_NFT_CONTRACT,
      networkId: "SN_MAIN",
      recipient: KEY_BOUNDARY_RECIPIENT,
      reviewedFee: { overallFee: "1", unit: "FRI" },
      tokenId: "1",
      type: "wallet.transferNft",
    },
    sender: extensionSender,
  },
];
