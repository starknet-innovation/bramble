/**
 * STRK20 catalog entries for the key-boundary scan, split from
 * ./key-boundary-messages to keep both files under the size budget. Same
 * enforcement: every handled wallet.strk20* type must appear here.
 */
import type { RuntimeSender } from "../../src/background/senders";

const ORIGIN = "https://dapp.example";

/**
 * Builds one best-effort-valid request per handled STRK20 message type.
 */
export const strk20KeyBoundaryMessages = (
  extensionSender: RuntimeSender,
  contentSender: RuntimeSender,
): readonly { readonly message: Record<string, unknown>; readonly sender: RuntimeSender }[] => [
  { message: { origin: ORIGIN, type: "wallet.strk20Balances" }, sender: contentSender },
  { message: { origin: ORIGIN, type: "wallet.strk20Register" }, sender: contentSender },
  {
    message: { origin: ORIGIN, params: {}, type: "wallet.strk20InvokeTransaction" },
    sender: contentSender,
  },
  {
    message: { origin: ORIGIN, params: {}, type: "wallet.strk20PrepareInvoke" },
    sender: contentSender,
  },
  {
    message: {
      dappName: "mc-terminal",
      origin: ORIGIN,
      type: "wallet.strk20SubaccountCommitment",
    },
    sender: contentSender,
  },
  { message: { type: "wallet.strk20State" }, sender: extensionSender },
  { message: { type: "wallet.strk20PrepareRegistration" }, sender: extensionSender },
  {
    message: { amount: "1", tokenId: "SN_MAIN:0x1", type: "wallet.strk20PrepareDeposit" },
    sender: extensionSender,
  },
  {
    message: {
      amount: "1",
      recipient: "0x123",
      tokenId: "SN_MAIN:0x1",
      type: "wallet.strk20PrepareTransfer",
    },
    sender: extensionSender,
  },
  {
    message: {
      amount: "1",
      recipient: "0x123",
      tokenId: "SN_MAIN:0x1",
      type: "wallet.strk20PrepareWithdraw",
    },
    sender: extensionSender,
  },
  {
    message: { address: "0x123", tokenId: "SN_MAIN:0x1", type: "wallet.strk20RecipientStatus" },
    sender: extensionSender,
  },
  {
    message: {
      preparationId: `sha256:${"0".repeat(64)}`,
      type: "wallet.strk20Execute",
    },
    sender: extensionSender,
  },
];
