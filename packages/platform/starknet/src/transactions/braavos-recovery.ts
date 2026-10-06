/**
 * Seed-driven Braavos 2FA removal (the vendor's "deferred removal"): the one
 * transaction a strong-signer Braavos account accepts from the stark key
 * alone — a single self-call to `deferred_remove_signers` with empty calldata,
 * no paymaster, and a fee the account caps on-chain. After the account's
 * execution time delay the account itself treats the strong signers as
 * removed, so the ordinary signing checks start passing with no further
 * transaction; during the window only the strong-signer device can cancel.
 * When it applies (lazily, on the account's next `__validate__`) the account
 * removes every strong signer, its multisig threshold and any withdrawal
 * limits, leaving the stark key — the recovery phrase — in sole control.
 * This module deliberately bypasses the strong-signer refusal that guards
 * every other submission, mirroring the carve-out the account contract makes.
 */
import { WalletError } from "@bramble/core/errors";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import type { FeeEstimate } from "../rpc/fee-bounds";
import {
  type AccountHashSigner,
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
  krustyAccount,
  matchingAcceptedRpcWriteHash,
  withRpcFallback,
  withRpcWrite,
} from "../rpc/provider";
import { atAcceptedBlock, braavosSigningRestriction } from "./account-compatibility";
import {
  capturingRecoverySigner,
  RECOVERY_TIP,
  recoveryFeeCeiling,
  refuseKeylessRecovery,
  requireWithinReviewedRecoveryFee,
} from "./recovery-shared";

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

/**
 * Inputs shared by the recovery review and submission. `onSigned` receives the
 * submission hash after it is signed and before it is broadcast, so the caller
 * can journal a write whose reply is lost.
 */
export type BraavosRecoveryInput = {
  readonly account: AccountRef;
  readonly isAuthorized?: () => boolean;
  readonly onSigned?: (transactionHash: string) => void;
  readonly reviewedFee?: FeeEstimate;
  readonly rpcUrls: readonly string[];
  readonly signHash: AccountHashSigner;
};

/**
 * What the confirmation states: the maximum fee the submission may sign
 * under, the account's delay, and the moment after which the removal takes
 * effect if it is sent now (the latest block's time plus the delay; the real
 * expiry is set from the inclusion block, so it can only be later).
 */
export type BraavosRecoveryReview = {
  readonly delaySeconds: number;
  readonly effectiveAfter: number;
  readonly fee: FeeEstimate;
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
  blockIdentifier = "latest",
): Promise<bigint> => {
  const [value] = await provider.callContract(
    { calldata: [], contractAddress, entrypoint },
    blockIdentifier,
  );
  return value === undefined ? 0n : BigInt(value);
};

const readDelaySeconds = async (provider: RpcProvider, address: string): Promise<number> => {
  const delay = await readFelt(provider, address, "get_execution_time_delay");
  return delay === 0n ? DEFAULT_BRAAVOS_RECOVERY_DELAY_SECONDS : Number(delay);
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
      return {
        delaySeconds: await readDelaySeconds(provider, accountAddress),
        pendingUntil: expireAt === 0n ? null : Number(expireAt),
      };
    },
    makeProvider,
  );

// The flow exists exactly for a deployed, phrase-held Braavos account whose
// only restriction is the strong signer and which has no request pending (the
// account refuses a second one); anything else is refused before signing.
// Every gate read sits at one pinned accepted block, so the class, signers and
// pending request it decides on coexisted.
const requireRecoverableBraavos = async (
  provider: RpcProvider,
  account: AccountRef,
): Promise<void> => {
  if (account.accountContractType !== "braavos") {
    throw new WalletError("Account recovery is only available for Braavos accounts");
  }
  refuseKeylessRecovery(account);
  await atAcceptedBlock(provider, (blockIdentifier) =>
    requireRecoverableBraavosAt(provider, account, blockIdentifier),
  );
};

const requireRecoverableBraavosAt = async (
  provider: RpcProvider,
  account: AccountRef,
  blockIdentifier: string,
): Promise<void> => {
  const restriction = await braavosSigningRestriction(
    provider,
    { address: account.address, publicKeyX: account.publicKeyX },
    blockIdentifier,
  );
  if (restriction === null) {
    throw new WalletError("This account has no 2FA signer to remove");
  }
  if (restriction !== "strong-signer") {
    throw new WalletError("Deployed Braavos account owner does not match the wallet signer");
  }
  const pending = await readFelt(
    provider,
    account.address,
    "get_deferred_remove_signers",
    blockIdentifier,
  );
  if (pending !== 0n) {
    throw new WalletError("A 2FA removal is already pending for this account");
  }
};

// Estimates with validation on, like a Braavos deployment: the account's
// __validate__ does real work for this call, and a skipped-validation quote
// would understate the fee the submission is then held to. The phrase key
// signs only the query-version hash, which can never be broadcast as a real
// transaction.
const estimateRecovery = (starknetAccount: ReturnType<typeof krustyAccount>, address: string) =>
  starknetAccount.estimateInvokeFee(recoveryCall(address), {
    skipValidate: false,
    tip: RECOVERY_TIP,
  });

/**
 * Estimates the removal request and returns what its confirmation states.
 * Refuses an account the flow does not apply to, and a fee over the account's
 * own on-chain cap.
 */
export const reviewBraavosRecovery = async (
  { account, rpcUrls, signHash }: BraavosRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
): Promise<BraavosRecoveryReview> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      await requireRecoverableBraavos(provider, account);
      const estimate = await estimateRecovery(
        makeAccount(provider, account, signHash),
        account.address,
      );
      const fee = recoveryFeeCeiling(estimate, MAX_RECOVERY_FEE_FRI);
      const delaySeconds = await readDelaySeconds(provider, account.address);
      const block = await provider.getBlock("latest");
      return { delaySeconds, effectiveAfter: Number(block.timestamp) + delaySeconds, fee };
    },
    makeProvider,
  );

/**
 * Submits the removal request and returns its hash and the moment it takes
 * effect. `reviewedFee` is mandatory and is the ceiling the confirmation
 * stated; the submission re-checks the account state, the fee and the on-chain
 * cap before anything is signed. Once the node has accepted the hash, any
 * later failure is reported as indeterminate: the request may be on chain.
 */
export const submitBraavosRecovery = async (
  { account, isAuthorized, onSigned, reviewedFee, rpcUrls, signHash }: BraavosRecoveryInput,
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
      const estimate = await estimateRecovery(
        makeAccount(provider, account, signHash),
        account.address,
      );
      requireWithinReviewedRecoveryFee(estimate, reviewedFee, MAX_RECOVERY_FEE_FRI);
      const capture = capturingRecoverySigner(signHash, isAuthorized, onSigned);
      const submitted = await makeAccount(provider, account, capture.signer).execute(
        recoveryCall(account.address),
        { resourceBounds: estimate.resourceBounds, tip: RECOVERY_TIP },
      );
      const transactionHash = matchingAcceptedRpcWriteHash(
        submitted.transaction_hash,
        capture.signedHash(),
      );
      try {
        await provider.waitForTransaction(transactionHash);
        const expireAt = await readFelt(provider, account.address, "get_deferred_remove_signers");
        return { pendingUntil: expireAt === 0n ? null : Number(expireAt), transactionHash };
      } catch {
        throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
      }
    },
    makeProvider,
  );
