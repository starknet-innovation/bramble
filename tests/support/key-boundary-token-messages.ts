/** Token-management requests included in the exhaustive background message scan. */
import {
  extensionSender,
  KEY_BOUNDARY_NFT_CONTRACT,
  KEY_BOUNDARY_TOKENS,
} from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

/** Live token requests: add, detect, price, chart, hide, and remove. */
export const TOKEN_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  {
    message: { address: KEY_BOUNDARY_NFT_CONTRACT, type: "wallet.addToken" },
    sender: extensionSender,
  },
  { message: { type: "wallet.detectTokens" }, sender: extensionSender },
  { message: { type: "wallet.prices" }, sender: extensionSender },
  {
    message: { address: KEY_BOUNDARY_TOKENS.eth.address, type: "wallet.tokenChart" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ tokenId: ids.tokenId }),
    message: { hidden: true, tokenId: "", type: "wallet.setTokenHidden" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ tokenId: await ids.removableTokenId() }),
    message: { tokenId: "", type: "wallet.removeToken" },
    sender: extensionSender,
  },
];
