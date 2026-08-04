/**
 * STRK20 requests for the exhaustive background key-boundary scan.
 */
import type { RuntimeSender } from "../../src/background/senders";

/** One request and the runtime sender that is allowed to issue it. */
export type KeyBoundaryMessage = {
  readonly message: Record<string, unknown>;
  readonly sender: RuntimeSender;
};

type Strk20MessageFixtures = {
  readonly contentSender: RuntimeSender;
  readonly extensionSender: RuntimeSender;
  readonly origin: string;
};

/** Builds the STRK20 portion of the key-boundary message catalog. */
export const strk20KeyBoundaryMessages = ({
  contentSender,
  extensionSender,
  origin,
}: Strk20MessageFixtures): readonly KeyBoundaryMessage[] => [
  {
    message: {
      config: {
        discoveryUrl: "https://discovery.example",
        poolAddress: "0x1",
        proverUrl: "https://prover.example",
        subaccountAnonymizerAddress: "0x2",
      },
      networkId: "SN_MAIN",
      type: "wallet.setStrk20NetworkConfig",
    },
    sender: extensionSender,
  },
  { message: { origin, type: "wallet.strk20Balances" }, sender: contentSender },
  { message: { origin, type: "wallet.strk20Register" }, sender: contentSender },
  {
    message: { origin, params: {}, type: "wallet.strk20InvokeTransaction" },
    sender: contentSender,
  },
  {
    message: { origin, params: {}, type: "wallet.strk20PrepareInvoke" },
    sender: contentSender,
  },
  {
    message: {
      dappName: "mc-terminal",
      origin,
      type: "wallet.strk20SubaccountCommitment",
    },
    sender: contentSender,
  },
  { message: { type: "wallet.strk20State" }, sender: extensionSender },
  { message: { type: "wallet.strk20PrepareRegistration" }, sender: extensionSender },
  {
    message: {
      amount: "1",
      tokenId: "SN_MAIN:0x1",
      type: "wallet.strk20PrepareDeposit",
    },
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
