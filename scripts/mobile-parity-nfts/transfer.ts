/**
 * The `transfer` block: an NFT send through the background's message handler, the review
 * (`wallet.reviewNftTransfer`) then the send (`wallet.transferNft`, under the reviewed fee), with
 * the production readers and send path behind it (`getNftOwnership`, `estimateInvokeFee`,
 * `getDeploymentStatus`, `estimateAccountDeploymentFee`, `submitInvokeTransaction`) over the
 * fake node: `starknet_call` answered by selector, the account's chain by the transaction
 * capture's canned OpenZeppelin node (`../mobile-transactions-capture`). The signer is Krusty over
 * the published parity phrase's account 0 on Sepolia, so every hash and signature is public.
 *
 * Each case writes both messages, both replies, every exchange of each, the signatures, and the
 * Activity rows after. A refusal before review or send stops the case there.
 */

import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import {
  estimateAccountDeploymentFee,
  estimateInvokeFee,
  getDeploymentStatus,
  submitInvokeTransaction,
} from "@bramble/starknet/rpc";
import { extensionSender } from "../../tests/support/background-wallet-stub";
import {
  DEPLOY_ESTIMATE,
  INVOKE_ESTIMATE,
  type Injection,
  type NodeState,
  type Recorder,
} from "../mobile-transactions-capture";
import { createBackground } from "./flows";
import {
  type Answer,
  type Contracts,
  ERC721,
  ERC1155,
  LEGACY721,
  NOT_NFT,
  parityAccount,
  plain,
  STRANGER,
  u256Reply,
  withNode,
} from "./shared";

const ok = (result: unknown): Answer => ({ result });

type Case = {
  readonly name: string;
  readonly contract?: string;
  readonly tokenId?: string;
  /** Who receives: the phrase's account 1, the sender itself, a lookalike of a contact, or a value. */
  readonly to?: "friend" | "self" | "lookalike" | string;
  readonly networkId?: string;
  readonly state?: NodeState;
  /** A fault the node shows only once the user confirms. */
  readonly inject?: Injection;
  /** Skip the review and send with no reviewed fee. */
  readonly unreviewed?: true;
  readonly locked?: true;
  /** Replaces the chain's answers for these contracts. */
  readonly contracts?: Contracts;
};

// The node's re-estimate at submission costs more than the review's (as `mobile-parity-calls`).
const feeRose: Injection = (method, params) => {
  if (method !== "starknet_estimateFee") return undefined;
  const request = (params?.["request"] ?? []) as readonly { readonly type: string }[];
  const rose = { ...INVOKE_ESTIMATE, l2_gas_consumed: "0x48d280" };
  return {
    result: request.map((entry) => (entry.type === "DEPLOY_ACCOUNT" ? DEPLOY_ESTIMATE : rose)),
  };
};
const lostBroadcast: Injection = (method) =>
  method === "starknet_addInvokeTransaction" ? "transport" : undefined;

const CASES: readonly Case[] = [
  { name: "an ERC-721 to a saved contact" },
  { contract: ERC1155, name: "an ERC-1155 (one edition) to a saved contact" },
  { name: "the largest token id", tokenId: ((1n << 256n) - 1n).toString() },
  { name: "to a lookalike of a saved contact", to: "lookalike" },
  { name: "to the account itself", to: "self" },
  { name: "to an address the wallet does not know", to: STRANGER },
  { contract: LEGACY721, name: "an NFT the account does not own" },
  {
    contract: ERC1155,
    contracts: { [ERC1155]: { balance_of: ok(u256Reply(0n)) } },
    name: "an ERC-1155 balance of 0",
  },
  { contract: NOT_NFT, name: "not an NFT contract" },
  { name: "a send with no reviewed fee", unreviewed: true },
  { name: "a zero recipient", to: "0x0" },
  { name: "a hex token id", tokenId: "0x7" },
  { name: "another network", networkId: "SN_MAIN" },
  { locked: true, name: "locked" },
  { name: "the fee rose past the reviewed one", inject: feeRose },
  { name: "the broadcast reply was lost", inject: lostBroadcast },
  { name: "an undeployed account deploys first", state: { deployed: false, nonce: "0x0" } },
];

/** The `transfer` block. */
export const computeTransfer = async () => {
  const { account, kms, privateKey } = await parityAccount("SN_SEPOLIA", 0);
  const friend = (await parityAccount("SN_SEPOLIA", 1)).account.address;
  const padded = `0x${friend.slice(2).padStart(64, "0")}`;
  const lookalike = `${padded.slice(0, 10)}${"1".repeat(50)}${padded.slice(-6)}`;
  const chain: Contracts = {
    [ERC721]: { owner_of: ok([account.address]) },
    [LEGACY721]: { ownerOf: ok([STRANGER]) },
    [ERC1155]: { balance_of: ok(u256Reply(3n)) },
  };
  const cases = [];
  for (const one of CASES) {
    const recorder: Recorder = {
      events: new Set(),
      exchanges: [],
      signatures: [],
      state: one.state ?? { deployed: true, nonce: "0x5" },
    };
    const background = await createBackground({
      account,
      ...(one.locked ? { locked: true } : {}),
      preferences: (store: WalletPreferencesStore) =>
        store.saveAddress({ address: friend, label: "Friend", networkId: "SN_SEPOLIA" }),
      rpc: {
        estimateAccountDeploymentFee: (input) => estimateAccountDeploymentFee(input),
        estimateInvokeFee: (input) => estimateInvokeFee(input),
        getDeploymentStatus: (input) => getDeploymentStatus(input),
        submitInvokeTransaction: (input) => submitInvokeTransaction(input),
      },
      signHash: async ({ messageHash }: { readonly messageHash: string }) => {
        const signed = await kms.signStarkHash(privateKey, messageHash);
        recorder.signatures.push({ hash: messageHash, r: signed.r, s: signed.s });
        return signed;
      },
    });
    const to =
      one.to === undefined || one.to === "friend"
        ? friend
        : one.to === "self"
          ? account.address
          : one.to === "lookalike"
            ? lookalike
            : one.to;
    const target = {
      contract: one.contract ?? ERC721,
      networkId: one.networkId ?? "SN_SEPOLIA",
      recipient: to,
      tokenId: one.tokenId ?? "7",
    };
    const node = { account, recorder };
    const contracts = { ...chain, ...one.contracts };
    const reviewMessage = { ...target, type: "wallet.reviewNftTransfer" };
    const review = one.unreviewed
      ? null
      : await withNode(contracts, () => background.handler(reviewMessage, extensionSender), node);
    const reviewed = review?.result as
      | { review?: { fee?: unknown; deploymentFee?: unknown } }
      | undefined;
    const fees = reviewed?.review
      ? {
          ...(reviewed.review.deploymentFee
            ? { reviewedDeploymentFee: reviewed.review.deploymentFee }
            : {}),
          reviewedFee: reviewed.review.fee,
        }
      : {};
    const sendMessage = { ...target, ...fees, type: "wallet.transferNft" };
    let send = null;
    if (one.unreviewed || reviewed?.review) {
      recorder.events.clear();
      if (one.inject) recorder.inject = one.inject;
      send = await withNode(
        contracts,
        () => background.handler(sendMessage, extensionSender),
        node,
      );
    }
    cases.push({
      account: { address: account.address, id: account.id, networkId: account.networkId },
      activity: plain(await background.activity.list()),
      contact: { address: friend, label: "Friend" },
      name: one.name,
      review: review && {
        exchanges: review.exchanges,
        message: reviewMessage,
        reply: plain(review.result),
      },
      send: send && { exchanges: send.exchanges, message: sendMessage, reply: plain(send.result) },
      signatures: recorder.signatures,
      state: one.state ?? { deployed: true, nonce: "0x5" },
    });
  }
  return cases;
};
