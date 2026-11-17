/**
 * Fee estimate and immediate submission for a dapp invoke from an Argent
 * multisig. Estimation uses a shape-correct query aggregate so validation
 * runs without key material. Submission signs with one local member and is
 * only valid when the threshold is 1. The reviewed fee is a ceiling, the same
 * rule a single-signer invoke is held to.
 */

import { WalletError } from "@bramble/core/errors";
import { STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import { type Call, num, type RpcProvider } from "starknet";
import {
  ARGENT_MULTISIG_CONTRACT,
  type ArgentMultisigConfig,
  normalizeArgentMultisigConfig,
} from "../accounts/account-contracts";
import {
  authorizedSpendFor,
  exceedsReviewedFee,
  type FeeEstimate,
  reviewedSpendFor,
} from "./fee-bounds";
import {
  type ArgentMultisigAccountDescriptor,
  argentQueryAccount,
  krustyAccount,
  matchingAcceptedRpcWriteHash,
  type StarkHashSigner,
  withRpcFallback,
  withRpcWrite,
} from "./provider";
import { REVIEWED_FEE_EXCEEDED, REVIEWED_FEE_REQUIRED, type SignedInvoke } from "./rpc-submit";

type ArgentMultisigDappInvoke = {
  readonly account: ArgentMultisigAccountDescriptor;
  readonly calls: readonly Call[];
  readonly config: ArgentMultisigConfig;
  readonly rpcUrls: readonly string[];
};

const queryDetails = { skipValidate: false, tip: "0x0" } as const;

const classMatches = async (provider: RpcProvider, address: string): Promise<void> => {
  const live = await provider.getClassHashAt(address);
  if (!sameFelt(live, ARGENT_MULTISIG_CONTRACT.classHash)) {
    throw new WalletError("Argent multisig class hash does not match the pinned release");
  }
};

const copiedCalls = (calls: readonly Call[]): Call[] =>
  calls.map((call) => ({
    ...call,
    calldata: Array.isArray(call.calldata) ? [...call.calldata] : [],
  }));

/**
 * Estimates a multisig invoke with validation enabled and no private key.
 * Fails when the address is not the pinned Argent multisig class.
 */
export const estimateArgentMultisigDappFee = async (
  input: ArgentMultisigDappInvoke,
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<FeeEstimate> => {
  if (input.calls.length === 0) throw new WalletError("No calls to estimate");
  const config = normalizeArgentMultisigConfig(input.config);
  return withRpcFallback(
    input.rpcUrls,
    async (provider) => {
      await classMatches(provider, input.account.address);
      const query = argentQueryAccount(provider, input.account, { multisig: config });
      const estimate = await query.estimateInvokeFee(copiedCalls(input.calls), queryDetails);
      return reviewedSpendFor(estimate, "standard");
    },
    makeProvider,
  );
};

/**
 * Signs and submits a threshold-1 multisig invoke under the reviewed fee.
 * The bounds signed are the bounds just estimated. A risen fee refuses
 * before anything is signed or broadcast.
 */
export const submitArgentMultisigDappInvoke = async (
  input: ArgentMultisigDappInvoke & {
    readonly isAuthorized?: () => boolean;
    readonly onSigned?: (signed: SignedInvoke) => Promise<void>;
    readonly reviewedFee: FeeEstimate;
    readonly signHash: StarkHashSigner;
  },
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<{ readonly transactionHash: string }> => {
  if (input.calls.length === 0) throw new WalletError("No calls to submit");
  if (!input.reviewedFee) throw new WalletError(REVIEWED_FEE_REQUIRED);
  const config = normalizeArgentMultisigConfig(input.config);
  if (config.threshold !== 1) {
    throw new WalletError("Argent multisig threshold is above 1");
  }
  return withRpcWrite(
    input.rpcUrls,
    STARKNET_NETWORKS[input.account.networkId].chainId,
    async (provider) => {
      await classMatches(provider, input.account.address);
      const query = argentQueryAccount(provider, input.account, { multisig: config });
      const estimate = await query.estimateInvokeFee(copiedCalls(input.calls), queryDetails);
      const authorized = authorizedSpendFor(estimate, "standard");
      if (!authorized || exceedsReviewedFee(input.reviewedFee, authorized)) {
        throw new WalletError(REVIEWED_FEE_EXCEEDED);
      }
      let nonce = "0x0";
      let signedHash: string | undefined;
      const account = krustyAccount(
        provider,
        input.account,
        async (messageHash) => {
          signedHash = messageHash;
          const signed = await input.signHash(messageHash);
          await input.onSigned?.({
            nonce,
            senderAddress: input.account.address,
            transactionHash: messageHash,
          });
          return signed;
        },
        { multisig: config },
      );
      nonce = num.toHex(await account.getNonce());
      if (input.isAuthorized?.() === false) throw new WalletError("wallet locked");
      const result = await account.execute([...input.calls], {
        nonce,
        resourceBounds: estimate.resourceBounds,
        tip: "0x0",
      } as Parameters<typeof account.execute>[1]);
      return {
        transactionHash: matchingAcceptedRpcWriteHash(result.transaction_hash, signedHash),
      };
    },
    makeProvider,
  );
};
