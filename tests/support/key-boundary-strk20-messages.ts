/**
 * STRK20 requests for the exhaustive background key-boundary scan.
 *
 * These are the entries the scan most needs to be live: every one of them but
 * the network-config write really derives the account-scoped viewing key on its
 * way through the STRK20 service double, exactly where the official SDK adapter
 * would, so a response that never got past its input validator would leave the
 * one secret this module exists to guard completely unscanned. That set is
 * pinned in tests/background/key-boundary.test.ts, so this comment cannot drift
 * away from what the entries actually do.
 */
import {
  contentSender,
  extensionSender,
  KEY_BOUNDARY_ORIGIN,
  KEY_BOUNDARY_RECIPIENT,
  KEY_BOUNDARY_TOKENS,
} from "./key-boundary-fixtures";
import type { KeyBoundaryMessage } from "./key-boundary-types";

const origin = KEY_BOUNDARY_ORIGIN;
const recipient = KEY_BOUNDARY_RECIPIENT;
const token = KEY_BOUNDARY_TOKENS.eth.address;

/** The STRK20 portion of the key-boundary message catalog. */
export const STRK20_KEY_BOUNDARY_MESSAGES: readonly KeyBoundaryMessage[] = [
  {
    // Routed at SN_SEPOLIA so the active network keeps the bundled Mainnet
    // routing every other STRK20 entry below is exercised against.
    message: {
      config: {
        discoveryUrl: "https://discovery.example",
        ohttpEnabled: false,
        poolAddress: "0x1",
        proverUrl: "https://prover.example",
        subaccountAnonymizerAddress: "0x2",
      },
      networkId: "SN_SEPOLIA",
      type: "wallet.setStrk20NetworkConfig",
    },
    sender: extensionSender,
  },
  {
    message: { origin, tokens: [token], type: "wallet.strk20Balances" },
    sender: contentSender,
  },
  {
    message: {
      actions: [{ amount: "0x1", recipient, token, type: "transfer" }],
      origin,
      type: "wallet.strk20InvokeTransaction",
    },
    sender: contentSender,
  },
  {
    message: {
      actions: [{ amount: "0x1", recipient, token, type: "transfer" }],
      origin,
      simulate: false,
      type: "wallet.strk20PrepareInvoke",
    },
    sender: contentSender,
  },
  {
    message: {
      dappName: "bramble-terminal",
      origin,
      type: "wallet.strk20SubaccountCommitment",
    },
    sender: contentSender,
  },
  { message: { type: "wallet.strk20State" }, sender: extensionSender },
  {
    live: async (ids) => ({ tokenId: ids.tokenId }),
    message: {
      amount: "1",
      recipient,
      tokenId: "",
      type: "wallet.strk20PrepareDeposit",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ tokenId: ids.tokenId }),
    message: {
      amount: "1",
      recipient,
      tokenId: "",
      type: "wallet.strk20PrepareTransfer",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ tokenId: ids.tokenId }),
    message: {
      amount: "1",
      recipient,
      tokenId: "",
      type: "wallet.strk20PrepareWithdraw",
    },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ tokenId: ids.tokenId }),
    message: { address: recipient, tokenId: "", type: "wallet.strk20RecipientStatus" },
    sender: extensionSender,
  },
  {
    live: async (ids) => ({ preparationId: await ids.strk20PreparationId() }),
    message: { preparationId: "", type: "wallet.strk20Execute" },
    sender: extensionSender,
  },
  // The two registration journeys come last: they are the only STRK20 entries
  // that require an account the pool has never seen, and the flip that puts the
  // account in that state is deliberately one-way.
  {
    live: async (ids) => {
      ids.unregisterStrk20Account();
      return {};
    },
    message: { type: "wallet.strk20PrepareRegistration" },
    sender: extensionSender,
  },
  { message: { origin, type: "wallet.strk20Register" }, sender: contentSender },
];
