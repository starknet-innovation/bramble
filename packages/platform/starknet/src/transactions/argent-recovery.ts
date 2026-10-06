/**
 * Phrase-driven Ready (Argent) guardian removal: the owner key alone escapes
 * the guardian, in the two steps the account's escape carve-out accepts from a
 * single owner signature — `trigger_escape_guardian(None)` starts the
 * security period, then from `ready_at` until `ready_at + period`
 * `escape_guardian()` removes the guardian at once and the account signs
 * normally again; past that window the escape expires and must be started
 * again. Cancelling in between needs the owner AND guardian together. Starting
 * an escape silently replaces any pending owner escape (the guardian's flow),
 * so that case is surfaced and needs an explicit acknowledgement. An account
 * with a backup guardian cannot escape to None and is refused up front. This module
 * deliberately bypasses the guardian refusal that guards every other
 * submission, mirroring the account's own carve-out.
 */
import { WalletError } from "@bramble/core/errors";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import type { RpcProvider } from "starknet";
import type { FeeEstimate } from "../rpc/fee-bounds";
import {
  type AccountHashSigner,
  argentQueryAccount,
  INDETERMINATE_RPC_WRITE_MESSAGE,
  IndeterminateRpcWriteError,
  isTransportRpcError,
  krustyAccount,
  matchingAcceptedRpcWriteHash,
  withRpcFallback,
  withRpcWrite,
} from "../rpc/provider";
import { argentSigningRestriction, atAcceptedBlock } from "./account-compatibility";
import {
  capturingRecoverySigner,
  RECOVERY_TIP,
  recoveryFeeCeiling,
  refuseKeylessRecovery,
  requireWithinReviewedRecoveryFee,
} from "./recovery-shared";

/**
 * The account's default security period (`DEFAULT_ESCAPE_SECURITY_PERIOD`,
 * seven days), used only if `get_escape_security_period` answers zero, which
 * the account itself never does.
 */
const DEFAULT_ESCAPE_SECURITY_PERIOD_SECONDS = 604_800;

// The account rejects an escape transaction whose fee exceeds this on-chain cap
// (MAX_ESCAPE_MAX_FEE_STRK, 5 STRK in fri), an anti-griefing bound. Enforced
// here too so the wallet never signs a request the account would reject.
const MAX_ESCAPE_FEE_FRI = 5n * 10n ** 18n;

/** Where a guardian escape stands, as the account's own view reports it. */
type ArgentRecoveryStatus = "none" | "pending" | "ready" | "expired";

/** Whether the account also has a backup guardian, as far as the chain answered. */
type GuardianBackup = "absent" | "present" | "unknown";

/** Refusal for an account with a backup guardian (see {@link readGuardianBackup}). */
const BACKUP_PRESENT =
  "This account has a backup guardian, so the guardian cannot be removed with the recovery phrase";
/** Refusal when the backup-guardian read failed: fail closed rather than revert on chain. */
const BACKUP_UNCHECKED = "Could not check this account's backup guardian";

/**
 * A live escape that starting a removal cancels, identified by its `ready_at`
 * so an acknowledgement covers that escape and not a later replacement.
 */
type PendingEscapeChange = {
  readonly kind: "guardian-change" | "owner-escape";
  readonly readyAt: number;
};

/** The step a confirmation offers: start the escape, or complete a ready one. */
export type ArgentRecoveryStep = "complete" | "start";

/**
 * The guardian-escape state the Home flag and the submit step read.
 * `readyAt`/`expiresAt` bound the window in which a guardian escape can be
 * completed (`expiresAt = readyAt + securityPeriodSeconds`), null when none is
 * recorded. `pendingChange` reports a live escape that starting a removal
 * would cancel — an OWNER escape (a key replacement the guardian approved) or
 * a guardian escape to a NEW guardian (a guardian change started with this
 * account's key, which this flow never completes) — with its `readyAt`, which
 * identifies that exact escape for the confirmation.
 * `guardianBackup` is `present` when the account also has a backup guardian
 * (the phrase cannot remove the guardian then) and `unknown` when that read
 * failed; callers treat `unknown` as unavailable, never as absent.
 */
export type ArgentRecoveryState = {
  readonly expiresAt: number | null;
  readonly guardianBackup: GuardianBackup;
  readonly pendingChange: PendingEscapeChange | null;
  readonly readyAt: number | null;
  readonly securityPeriodSeconds: number;
  readonly status: ArgentRecoveryStatus;
};

/**
 * What the confirmation states: the step, the maximum fee, the window in which
 * the removal can be completed (estimated from the latest block for a start,
 * the account's own for a completion), and the pending escape starting would
 * cancel, if any.
 */
export type ArgentRecoveryReview = {
  readonly expiresAt: number;
  readonly fee: FeeEstimate;
  readonly readyAt: number;
  readonly replaces: PendingEscapeChange | null;
  readonly step: ArgentRecoveryStep;
};

/**
 * Inputs shared by the Ready recovery review and submission. The submission
 * must name the `expectedStep` the user confirmed, and `replaceEscapeReadyAt`
 * — the `readyAt` of the pending escape its confirmation warned about — when
 * starting would cancel one; any other escape found at submit is refused.
 * `onSigned` receives the hash after signing and before broadcast.
 */
export type ArgentRecoveryInput = {
  readonly account: AccountRef;
  readonly expectedStep?: ArgentRecoveryStep;
  readonly isAuthorized?: () => boolean;
  readonly onSigned?: (transactionHash: string) => void;
  readonly replaceEscapeReadyAt?: number;
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

// LegacyEscapeType in the account: 0 none, 1 guardian, 2 owner.
const GUARDIAN_ESCAPE_TYPE = 1n;
const OWNER_ESCAPE_TYPE = 2n;
// EscapeStatus from the account's view: 0 none, 1 not-ready, 2 ready, 3 expired.
const STATUS_BY_CODE: Readonly<Record<string, ArgentRecoveryStatus>> = {
  "0": "none",
  "1": "pending",
  "2": "ready",
  "3": "expired",
};

// trigger_escape_guardian(None) is valid only when no backup guardian is set
// (`argent/backup-should-be-null` in __validate__), and the account rejects a
// guardian removal that would leave a backup behind. An empty answer is not
// "no backup": it throws, so callers fail closed.
const readGuardianBackup = async (
  provider: RpcProvider,
  accountAddress: string,
  blockIdentifier: string,
): Promise<"absent" | "present"> => {
  const [value] = await provider.callContract(
    { calldata: [], contractAddress: accountAddress, entrypoint: "get_guardian_backup" },
    blockIdentifier,
  );
  if (value === undefined) {
    throw new WalletError(BACKUP_UNCHECKED);
  }
  return BigInt(value) === 0n ? "absent" : "present";
};

// The new_signer of a guardian escape, from its Option<SignerStorageValue>
// serde: None (a removal) is the variant felt 1 alone; Some (a change to a new
// guardian) is the variant felt 0 followed by stored_value and signer_type.
// Anything else fails closed.
const guardianEscapeTarget = (escapeFelts: readonly string[]): "change" | "removal" => {
  const variant = escapeFelts[2] === undefined ? null : BigInt(escapeFelts[2]);
  if (variant === 1n && escapeFelts.length === 4) return "removal";
  if (variant === 0n && escapeFelts.length === 6) return "change";
  throw new WalletError("The account reported an unrecognised escape");
};

// Which pending change, if any, an escape is rather than a guardian removal:
// an owner escape (a key replacement the guardian approved), or a guardian
// escape to a NEW guardian (escape_guardian() would install it, not remove the
// guardian). Null for a guardian removal; an unknown type fails closed.
const pendingChangeOf = (
  escapeType: bigint,
  escapeFelts: readonly string[],
): PendingEscapeChange["kind"] | null => {
  if (escapeType === OWNER_ESCAPE_TYPE) return "owner-escape";
  if (escapeType !== GUARDIAN_ESCAPE_TYPE) {
    throw new WalletError("The account reported an unrecognised escape type");
  }
  return guardianEscapeTarget(escapeFelts) === "change" ? "guardian-change" : null;
};

const feltOrZero = (value: string | undefined): bigint =>
  value === undefined ? 0n : BigInt(value);

// Reads the escape on the given provider. get_escape_and_status returns
// (LegacyEscape, EscapeStatus): ready_at is the first felt, the escape type
// the second, and the status the last — whatever the variable-length
// new_signer in between serializes to. The account computes the status against
// its own block clock. An unrecognised type or status fails closed.
const readEscapeState = async (
  provider: RpcProvider,
  accountAddress: string,
  blockIdentifier = "latest",
): Promise<ArgentRecoveryState> => {
  const read = (entrypoint: string) =>
    provider.callContract(
      { calldata: [], contractAddress: accountAddress, entrypoint },
      blockIdentifier,
    );
  const [escapeFelts, period, guardianBackup] = await Promise.all([
    read("get_escape_and_status"),
    read("get_escape_security_period"),
    readGuardianBackup(provider, accountAddress, blockIdentifier).catch(
      (): GuardianBackup => "unknown",
    ),
  ]);
  const periodFelt = feltOrZero(period[0]);
  const securityPeriodSeconds =
    periodFelt === 0n ? DEFAULT_ESCAPE_SECURITY_PERIOD_SECONDS : Number(periodFelt);
  const readyAt = feltOrZero(escapeFelts[0]);
  const escapeType = feltOrZero(escapeFelts[1]);
  const status = STATUS_BY_CODE[String(feltOrZero(escapeFelts[escapeFelts.length - 1]))];
  if (status === undefined) {
    throw new WalletError("The account reported an unrecognised escape status");
  }
  const none = {
    expiresAt: null,
    guardianBackup,
    readyAt: null,
    securityPeriodSeconds,
    status: "none" as const,
  };
  if (readyAt === 0n || status === "none") {
    return { ...none, pendingChange: null };
  }
  const change = pendingChangeOf(escapeType, escapeFelts);
  if (change !== null) {
    // Not a removal this flow can show or complete. A live one is cancelled by
    // starting a removal (trigger_escape_guardian resets any escape); an
    // expired one is inert.
    const live = status === "pending" || status === "ready";
    return { ...none, pendingChange: live ? { kind: change, readyAt: Number(readyAt) } : null };
  }
  return {
    expiresAt: Number(readyAt) + securityPeriodSeconds,
    guardianBackup,
    pendingChange: null,
    readyAt: Number(readyAt),
    securityPeriodSeconds,
    status,
  };
};

/**
 * Reads where a guardian escape stands, its completion window, the account's
 * security period, and whether an owner escape is pending, via the account's
 * own views so the status reflects the chain's clock, not a local one.
 */
export const getArgentRecoveryState = async (
  {
    accountAddress,
    rpcUrls,
  }: { readonly accountAddress: string; readonly rpcUrls: readonly string[] },
  makeProvider?: (nodeUrl: string) => RpcProvider,
): Promise<ArgentRecoveryState> =>
  withRpcFallback(rpcUrls, (provider) => readEscapeState(provider, accountAddress), makeProvider);

// The flow applies only to a deployed, phrase-held Argent account whose sole
// restriction is a guardian; anything else is refused before signing. The
// gate and the escape state it returns are read at one pinned accepted block,
// so the class, owner, guardian, backup and escape all coexisted.
const recoverableEscapeState = async (
  provider: RpcProvider,
  account: AccountRef,
): Promise<ArgentRecoveryState> => {
  if (account.accountContractType !== "argent") {
    throw new WalletError("Account recovery is only available for Ready accounts");
  }
  refuseKeylessRecovery(account);
  return atAcceptedBlock(provider, async (blockIdentifier) => {
    await requireRecoverableArgentAt(provider, account, blockIdentifier);
    return readEscapeState(provider, account.address, blockIdentifier);
  });
};

const requireRecoverableArgentAt = async (
  provider: RpcProvider,
  account: AccountRef,
  blockIdentifier: string,
): Promise<void> => {
  const restriction = await argentSigningRestriction(
    provider,
    { address: account.address, publicKeyX: account.publicKeyX },
    blockIdentifier,
  );
  if (restriction === null) {
    throw new WalletError("This account has no guardian to remove");
  }
  if (restriction !== "guardian") {
    throw new WalletError("Deployed Argent account owner does not match the wallet signer");
  }
  // Transport failures keep their own classification (and endpoint fallback);
  // any other failed read refuses rather than letting the escape revert.
  const backup = await readGuardianBackup(provider, account.address, blockIdentifier).catch(
    (error: unknown) => {
      if (isTransportRpcError(error)) throw error;
      throw new WalletError(BACKUP_UNCHECKED);
    },
  );
  if (backup === "present") {
    throw new WalletError(BACKUP_PRESENT);
  }
};

// Which escape step advances the removal from the live status: start it when
// none is pending or the last one expired, complete it once it is ready, and
// refuse while the security period is still running.
const nextStep = (status: ArgentRecoveryStatus): ArgentRecoveryStep => {
  if (status === "none" || status === "expired") return "start";
  if (status === "ready") return "complete";
  throw new WalletError("Guardian removal is still in its waiting period");
};

const callFor = (address: string, step: ArgentRecoveryStep) =>
  step === "start" ? triggerCall(address) : completeCall(address);

// Validated estimate through the query signer: the escape call does real work
// in __validate__ (the rate-limit bookkeeping) that a skipped-validation quote
// under-prices, and the account accepts a shape-correct dummy owner entry for
// a query-version transaction. No key — phrase or Ledger — is asked to sign.
const estimateStep = (
  provider: RpcProvider,
  account: AccountRef,
  step: ArgentRecoveryStep,
  makeQueryAccount: typeof argentQueryAccount,
) =>
  makeQueryAccount(provider, account).estimateInvokeFee(callFor(account.address, step), {
    skipValidate: false,
    tip: RECOVERY_TIP,
  });

// The live step, refused unless it is the one the user confirmed and, when it
// cancels a pending escape, the acknowledgement names that exact escape (a
// cancelled and re-triggered one has a different ready_at).
const confirmedStep = (
  state: ArgentRecoveryState,
  expectedStep: ArgentRecoveryStep,
  replaceEscapeReadyAt: number | undefined,
): ArgentRecoveryStep => {
  const step = nextStep(state.status);
  if (step !== expectedStep) {
    throw new WalletError("The recovery step changed. Review it and try again.");
  }
  const pending = step === "start" ? state.pendingChange : null;
  if (pending !== null && replaceEscapeReadyAt !== pending.readyAt) {
    throw new WalletError(
      pending.kind === "owner-escape"
        ? "A guardian-approved key change is pending. Review it and try again."
        : "A guardian change is pending. Review it and try again.",
    );
  }
  return step;
};

/**
 * Estimates the next escape step and returns what its confirmation states.
 * Refuses an account the flow does not apply to, an escape still in its
 * waiting period, and a fee over the account's on-chain escape cap.
 */
export const reviewArgentRecovery = async (
  { account, rpcUrls }: ArgentRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeQueryAccount: typeof argentQueryAccount = argentQueryAccount,
): Promise<ArgentRecoveryReview> =>
  withRpcFallback(
    rpcUrls,
    async (provider) => {
      const state = await recoverableEscapeState(provider, account);
      const step = nextStep(state.status);
      const estimate = await estimateStep(provider, account, step, makeQueryAccount);
      const fee = recoveryFeeCeiling(estimate, MAX_ESCAPE_FEE_FRI);
      if (step === "complete" && state.readyAt !== null && state.expiresAt !== null) {
        return {
          expiresAt: state.expiresAt,
          fee,
          readyAt: state.readyAt,
          replaces: null,
          step,
        };
      }
      const block = await provider.getBlock("latest");
      const readyAt = Number(block.timestamp) + state.securityPeriodSeconds;
      return {
        expiresAt: readyAt + state.securityPeriodSeconds,
        fee,
        readyAt,
        replaces: state.pendingChange,
        step: "start",
      };
    },
    makeProvider,
  );

/**
 * Submits the confirmed escape step and returns its hash and the escape window
 * after it (null once completed). Refuses before signing when the live step
 * differs from `expectedStep`, when the pending escape found is not the one
 * the confirmation acknowledged, or when the fresh estimate exceeds the confirmed fee or the
 * on-chain cap. Once the node has accepted the hash, any later failure is
 * indeterminate: the step may be on chain.
 */
export const submitArgentRecovery = async (
  input: ArgentRecoveryInput,
  makeProvider?: (nodeUrl: string) => RpcProvider,
  makeAccount: typeof krustyAccount = krustyAccount,
  makeQueryAccount: typeof argentQueryAccount = argentQueryAccount,
): Promise<{
  readonly expiresAt: number | null;
  readonly readyAt: number | null;
  readonly transactionHash: string;
}> => {
  const { account, expectedStep, reviewedFee, rpcUrls } = input;
  return withRpcWrite(
    rpcUrls,
    STARKNET_NETWORKS[account.networkId].chainId,
    async (provider) => {
      if (!reviewedFee || expectedStep === undefined) {
        throw new WalletError("The recovery was not reviewed. Review it and try again.");
      }
      const state = await recoverableEscapeState(provider, account);
      const step = confirmedStep(state, expectedStep, input.replaceEscapeReadyAt);
      const estimate = await estimateStep(provider, account, step, makeQueryAccount);
      requireWithinReviewedRecoveryFee(estimate, reviewedFee, MAX_ESCAPE_FEE_FRI);
      const capture = capturingRecoverySigner(input.signHash, input.isAuthorized, input.onSigned);
      const submitted = await makeAccount(provider, account, capture.signer).execute(
        callFor(account.address, step),
        { resourceBounds: estimate.resourceBounds, tip: RECOVERY_TIP },
      );
      const transactionHash = matchingAcceptedRpcWriteHash(
        submitted.transaction_hash,
        capture.signedHash(),
      );
      try {
        await provider.waitForTransaction(transactionHash);
        const after = await readEscapeState(provider, account.address);
        return { expiresAt: after.expiresAt, readyAt: after.readyAt, transactionHash };
      } catch {
        throw new IndeterminateRpcWriteError(INDETERMINATE_RPC_WRITE_MESSAGE);
      }
    },
    makeProvider,
  );
};
