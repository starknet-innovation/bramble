/**
 * Seed-driven Braavos 2FA removal (the vendor's "deferred removal"): the one
 * transaction a strong-signer Braavos account accepts from the stark key
 * alone — a single self-call to `deferred_remove_signers` with empty calldata,
 * no paymaster, and a fee the account caps on-chain. After the account's
 * execution time delay the account itself treats the strong signers as
 * removed, so the ordinary signing checks start passing with no further
 * transaction; during the window only the strong-signer device can cancel.
 * This module deliberately bypasses the strong-signer refusal that guards
 * every other submission, mirroring the carve-out the account contract makes.
 */
import { WalletError } from "@bramble/core/errors";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import { type FeeEstimate, reviewedSpendFor } from "../rpc/fee-bounds";
import {
  type AccountHashSigner,
  acceptedRpcWriteHash,
  krustyAccount,
  withRpcFallback,
  withRpcWrite,
} from "../rpc/provider";

import { braavosSigningRestriction } from "./account-compatibility";

/**
 * The account-side delay between the removal request and it taking effect when
 * the account has not configured its own (`ACCOUNT_DEFAULT_ETD_SEC` in
 * braavos-account-cairo): four days.
 */
export const DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS = 345_600;

// The account refuses a removal request whose fee exceeds this on-chain cap
// (`MAX_ETD_FEE_V3`, 100 STRK in fri), so a griefed fee market cannot be used
// to drain a guarded account through the carve-out. Enforced here too, so the
// wallet never signs a request the account would reject.
const MAX_RECOVERY_FEE_FRI = 100_000_000_000_000_000_000n;

/** Inputs shared by the recovery review and submission. */
export type BraavosRecoveryInput = {
  readonly account: AccountRef;
  readonly isAuthorized?: () => boolean;
  readonly reviewedFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: AccountHashSigner;
};

/** Pending-state read: when the request takes effect, and the account's delay. */
export type BraavosRecoveryState = {
  readonly delaySeconds: number;
  readonly pendingUntil: number | null;
};

const RECOVERY_ENTRYPOINT = "deferred_remove_signers";

const recoveryCall = (address: string) => ({
  calldata: [] as string[],
  contractAddress: address,
  entrypoint: RECOVERY_ENTRYPOINT,
});

const readFelt = async (
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string,
): Promise<bigint> => {
  const [value] = await provider.callContract(
    { calldata: [], contractAddress, entrypoint },
    "latest",
  );
  return value === undefined ? 0n : BigInt(value);
};

/**
 * Reads the account's recovery state at the latest block: a pending request's
 * expiry (null when none is pending) and the delay a new request would take.
 * Read-only and advisory; the signing checks re-read authoritatively.
 */
export const getBraavosRecoveryState = async (
  {
    accountAddress,
    rpcUrls,
  }: { readonly accountAddress: string; readonly rpcUrls: readonly string[] },
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<BraavosRecoveryState> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      const expireAt = await readFelt(provider, accountAddress, "get_deferred_remove_signers");
      const delay = await readFelt(provider, accountAddress, "get_execution_time_delay");
      return {
        delaySeconds: delay === 0n ? DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS : Number(delay),
        pendingUntil: expireAt === 0n ? null : Number(expireAt),
      };
    },
    makeProvider,
  );

// The flow exists exactly for a deployed Braavos account whose only
// restriction is the strong signer; anything else is refused before signing.
const requireRecoverableBraavos = async (
  provider: RpcProvider,
  account: AccountRef,
): Promise<void> => {
  if (account.accountContractType !== "braavos") {
    throw new WalletError("Account recovery is only available for Braavos accounts");
  }
  const restriction = await braavosSigningRestriction(provider, {
    address: account.address,
    publicKeyX: account.publicKeyX,
  });
  if (restriction === null) {
    throw new WalletError("This account has no 2FA signer to remove");
  }
  if (restriction !== "strong-signer") {
    throw new WalletError("Deployed Braavos account owner does not match the wallet signer");
  }
};

/**
 * Estimates the removal request and returns the fee a review card can quote.
 * Refuses an account the flow does not apply to, and a fee over the account's
 * own on-chain cap.
 */
export const reviewBraavosRecovery = async (
  { account, rpcUrls, signHash }: BraavosRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<FeeEstimate> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      await requireRecoverableBraavos(provider, account);
      const starknetAccount = makeAccount(provider, account, signHash);
      const estimate = await starknetAccount.estimateInvokeFee(recoveryCall(account.address), {
        skipValidate: true,
        tip: "0x0",
      });
      const reviewed = reviewedSpendFor(estimate, "standard");
      if (BigInt(reviewed.overallFee) > MAX_RECOVERY_FEE_FRI) {
        throw new WalletError("Recovery fee exceeds the account's on-chain cap");
      }
      return reviewed;
    },
    makeProvider,
  );

/**
 * Submits the removal request and returns its hash and the moment it takes
 * effect. `reviewedFee` is mandatory and bounds the transaction exactly as a
 * reviewed invoke fee does; the submission re-checks the account state and the
 * on-chain fee cap before anything is signed.
 */
export const submitBraavosRecovery = async (
  { account, isAuthorized, reviewedFee, rpcUrls, signHash }: BraavosRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<{ readonly pendingUntil: number | null; readonly transactionHash: string }> =>
  withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      if (!reviewedFee) {
        throw new WalletError("The recovery fee was not reviewed. Review it and try again.");
      }
      await requireRecoverableBraavos(provider, account);
      let signedHash: string | undefined;
      const authorizedSigner: AccountHashSigner = async (messageHash) => {
        const signed = await signHash(messageHash);
        if (isAuthorized?.() === false) {
          throw new WalletError("wallet locked");
        }
        signedHash = messageHash;
        return signed;
      };
      const starknetAccount = makeAccount(provider, account, authorizedSigner);
      const estimate = await starknetAccount.estimateInvokeFee(recoveryCall(account.address), {
        skipValidate: true,
        tip: "0x0",
      });
      const spend = reviewedSpendFor(estimate, "standard");
      if (
        BigInt(spend.overallFee) > BigInt(reviewedFee.overallFee) ||
        spend.unit !== reviewedFee.unit ||
        BigInt(spend.overallFee) > MAX_RECOVERY_FEE_FRI
      ) {
        throw new WalletError("The recovery fee changed. Review it and try again.");
      }
      const submitted = await starknetAccount.execute(recoveryCall(account.address), {
        resourceBounds: estimate.resourceBounds,
        tip: "0x0",
      });
      const transactionHash = acceptedRpcWriteHash(submitted.transaction_hash);
      if (signedHash === undefined || BigInt(signedHash) !== BigInt(transactionHash)) {
        throw new WalletError(
          "RPC accepted a different transaction hash. Check on-chain state before retrying.",
        );
      }
      await provider.waitForTransaction(transactionHash);
      const expireAt = await readFelt(provider, account.address, "get_deferred_remove_signers");
      return {
        pendingUntil: expireAt === 0n ? null : Number(expireAt),
        transactionHash,
      };
    },
    makeProvider,
  );
