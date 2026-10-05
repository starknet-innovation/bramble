/**
 * Phrase-driven Ready (Argent) guardian removal: the owner key alone escapes
 * the guardian, in the two steps the account's escape carve-out accepts from a
 * single owner signature — `trigger_escape_guardian(None)` starts a security
 * period, then after it `escape_guardian()` removes the guardian and the
 * account signs normally again. Cancelling in between needs the full
 * owner+guardian pair, so the phrase cannot stop it alone — the copy says the
 * guardian still can. This module deliberately bypasses the guardian refusal
 * that guards every other submission, mirroring the account's own carve-out.
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
import { argentSigningRestriction } from "./account-compatibility";

/** The account-side delay before a triggered guardian escape may complete. */
export const DEFAULT_ARGENT_ESCAPE_SECURITY_PERIOD_SECONDS = 604_800;

// The account rejects an escape transaction whose fee exceeds this on-chain cap
// (MAX_ESCAPE_MAX_FEE_STRK, 5 STRK in fri), an anti-griefing bound. Enforced
// here too so the wallet never signs a request the account would reject.
const MAX_ESCAPE_FEE_FRI = 5n * 10n ** 18n;

/** Where a guardian escape stands, as the account's own view reports it. */
type ArgentRecoveryStatus = "none" | "pending" | "ready" | "expired";

/** The guardian-escape state the Home flag and the submit step read. */
export type ArgentRecoveryState = {
  readonly readyAt: number | null;
  readonly status: ArgentRecoveryStatus;
};

/** Inputs shared by the Ready recovery review and submission. */
export type ArgentRecoveryInput = {
  readonly account: AccountRef;
  readonly isAuthorized?: () => boolean;
  readonly reviewedFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: AccountHashSigner;
};

// Serde for Cairo's Option<Signer>: None is the single felt 1. Removing the
// guardian escapes it to None.
const REMOVE_GUARDIAN_CALLDATA = ["0x1"] as const;

const triggerCall = (address: string) => ({
  calldata: [...REMOVE_GUARDIAN_CALLDATA],
  contractAddress: address,
  entrypoint: "trigger_escape_guardian",
});
const completeCall = (address: string) => ({
  calldata: [] as string[],
  contractAddress: address,
  entrypoint: "escape_guardian",
});

// LegacyEscapeType in the account: 0 none, 1 guardian, 2 owner. Only a guardian
// escape is ours to advance; an owner escape belongs to the guardian's flow.
const GUARDIAN_ESCAPE_TYPE = 1n;
// EscapeStatus from the account's view: 0 none, 1 not-ready, 2 ready, 3 expired.
const STATUS_BY_CODE: Readonly<Record<string, ArgentRecoveryStatus>> = {
  "0": "none",
  "1": "pending",
  "2": "ready",
  "3": "expired",
};

/**
 * Reads where a guardian escape stands, via the account's own `get_escape` and
 * `get_escape_status` views, so the status reflects the chain's clock, not a
 * local one. A pending owner escape (the guardian's flow, not the phrase's)
 * reads as "none" here.
 */
export const getArgentRecoveryState = async (
  {
    accountAddress,
    rpcUrls,
  }: { readonly accountAddress: string; readonly rpcUrls: readonly string[] },
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<ArgentRecoveryState> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      // get_escape_and_status returns (LegacyEscape, EscapeStatus): ready_at is
      // the first felt, the escape type the second, and the status the last —
      // whatever the variable-length new_signer in between serializes to. The
      // account computes the status against its own block clock.
      const result = await provider.callContract(
        { calldata: [], contractAddress: accountAddress, entrypoint: "get_escape_and_status" },
        "latest",
      );
      const readyAt = result[0] === undefined ? 0n : BigInt(result[0]);
      const escapeType = result[1] === undefined ? 0n : BigInt(result[1]);
      const statusFelt = result[result.length - 1];
      if (readyAt === 0n || escapeType !== GUARDIAN_ESCAPE_TYPE) {
        return { readyAt: null, status: "none" as const };
      }
      const status = STATUS_BY_CODE[String(statusFelt === undefined ? 0n : BigInt(statusFelt))];
      return { readyAt: Number(readyAt), status: status ?? "none" };
    },
    makeProvider,
  );

// The flow applies only to a deployed Argent account whose sole restriction is
// a guardian; anything else is refused before signing.
const requireRecoverableArgent = async (
  provider: RpcProvider,
  account: AccountRef,
): Promise<void> => {
  if (account.accountContractType !== "argent") {
    throw new WalletError("Account recovery is only available for Ready accounts");
  }
  const restriction = await argentSigningRestriction(provider, {
    address: account.address,
    publicKeyX: account.publicKeyX,
  });
  if (restriction === null) {
    throw new WalletError("This account has no guardian to remove");
  }
  if (restriction !== "guardian") {
    throw new WalletError("Deployed Argent account owner does not match the wallet signer");
  }
};

// Which escape step advances the removal from the live status: start it when
// none is pending or the last one expired, complete it once it is ready, and
// refuse while the security period is still running.
const nextCall = (address: string, status: ArgentRecoveryStatus) => {
  if (status === "none" || status === "expired") return triggerCall(address);
  if (status === "ready") return completeCall(address);
  throw new WalletError("Guardian removal is still in its waiting period");
};

/** Estimates the next escape step and returns the fee a review card can quote. */
export const reviewArgentRecovery = async (
  { account, rpcUrls, signHash }: ArgentRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<FeeEstimate> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      await requireRecoverableArgent(provider, account);
      const { status } = await getArgentRecoveryState(
        { accountAddress: account.address, rpcUrls },
        makeProvider,
      );
      const call = nextCall(account.address, status);
      const estimate = await makeAccount(provider, account, signHash).estimateInvokeFee(call, {
        skipValidate: false,
        tip: "0x0",
      });
      const reviewed = reviewedSpendFor(estimate, "standard");
      if (BigInt(reviewed.overallFee) > MAX_ESCAPE_FEE_FRI) {
        throw new WalletError("Recovery fee exceeds the account's on-chain escape cap");
      }
      return reviewed;
    },
    makeProvider,
  );

/**
 * Submits the next escape step and returns its hash and the state after it:
 * triggering returns the moment the removal may complete; completing clears
 * the escape. `reviewedFee` bounds the transaction, re-checked before signing.
 */
export const submitArgentRecovery = async (
  { account, isAuthorized, reviewedFee, rpcUrls, signHash }: ArgentRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<{ readonly readyAt: number | null; readonly transactionHash: string }> =>
  withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      if (!reviewedFee) {
        throw new WalletError("The recovery fee was not reviewed. Review it and try again.");
      }
      await requireRecoverableArgent(provider, account);
      const { status } = await getArgentRecoveryState(
        { accountAddress: account.address, rpcUrls },
        makeProvider,
      );
      const call = nextCall(account.address, status);
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
      const estimate = await starknetAccount.estimateInvokeFee(call, {
        skipValidate: false,
        tip: "0x0",
      });
      // The escape fee is bounded by the account itself at MAX_ESCAPE_FEE_FRI,
      // so that protocol cap is the ceiling the submission honours; the
      // reviewed fee is the quote the user saw and is required, but a validated
      // escape estimate moves between review and submit, so it is not pinned to
      // the cent. A submit over the on-chain cap is refused before signing.
      const spend = reviewedSpendFor(estimate, "standard");
      if (spend.unit !== reviewedFee.unit || BigInt(spend.overallFee) > MAX_ESCAPE_FEE_FRI) {
        throw new WalletError("The recovery fee exceeds the account's on-chain escape cap");
      }
      const submitted = await starknetAccount.execute(call, {
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
      const after = await getArgentRecoveryState(
        { accountAddress: account.address, rpcUrls },
        makeProvider,
      );
      return { readyAt: after.readyAt, transactionHash };
    },
    makeProvider,
  );
