/**
 * Reads where a Ready (Argent) account's escape stands, from the account's own
 * views: the guardian escape and its completion window, a pending change that
 * starting a removal would cancel, the backup guardian, and the escape
 * rate-limit clocks. Split from ./argent-recovery by the size budget; pure
 * reads, no key material. Every unrecognised answer fails closed.
 */
import { WalletError } from "@bramble/core/errors";
import type { RpcProvider } from "starknet";
import { withRpcFallback } from "../rpc/provider";

/**
 * The account's default security period (`DEFAULT_ESCAPE_SECURITY_PERIOD`,
 * seven days), used only if `get_escape_security_period` answers zero, which
 * the account itself never does.
 */
const DEFAULT_ESCAPE_SECURITY_PERIOD_SECONDS = 604_800;

/** Where a guardian escape stands, as the account's own view reports it. */
export type ArgentRecoveryStatus = "none" | "pending" | "ready" | "expired";

/** Whether the account also has a backup guardian, as far as the chain answered. */
type GuardianBackup = "absent" | "present" | "unknown";

/** Refusal for an account with a backup guardian (see {@link readGuardianBackup}). */
export const BACKUP_PRESENT =
  "This account has a backup guardian, so the guardian cannot be removed with the recovery phrase";
/** Refusal when the backup-guardian read failed: fail closed rather than revert on chain. */
export const BACKUP_UNCHECKED = "Could not check this account's backup guardian";

/**
 * A live escape that starting a removal cancels, identified by its `ready_at`
 * so an acknowledgement covers that escape and not a later replacement.
 */
export type PendingEscapeChange = {
  readonly kind: "guardian-change" | "owner-escape";
  readonly readyAt: number;
};

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

/**
 * Reads whether a backup guardian is set, at `blockIdentifier`.
 * trigger_escape_guardian(None) is valid only when none is
 * (`argent/backup-should-be-null` in __validate__). An empty answer is not
 * "no backup": it throws, so callers fail closed.
 */
export const readGuardianBackup = async (
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

/**
 * Reads the escape at `blockIdentifier` (latest by default).
 * get_escape_and_status returns (LegacyEscape, EscapeStatus): ready_at is the
 * first felt, the escape type the second, the new_signer Option next, and the
 * status last. The account computes the status against its own block clock.
 * An unrecognised type, status or new_signer fails closed.
 */
export const readEscapeState = async (
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

/** The account's TIME_BETWEEN_TWO_ESCAPES: one escape attempt of a kind per 12 hours. */
const ESCAPE_ATTEMPT_INTERVAL_SECONDS = 43_200n;

/** Refusal when the account's 12-hour escape limit would reject the step. */
export const ESCAPE_TOO_RECENT = "This account allows one escape attempt every 12 hours";

/** Refusal when the escape-limit clock could not be read: fail closed. */
const ESCAPE_LIMIT_UNCHECKED = "Could not check this account's escape limit";

// The account's revert reason for that limit, as text and as the felt
// short-string an RPC error may carry instead.
const TOO_RECENT_REASONS = [
  "argent/last-escape-too-recent",
  "0x617267656e742f6c6173742d6573636170652d746f6f2d726563656e74",
] as const;

/**
 * Whether an estimate failed on exactly the account's 12-hour escape limit
 * (`argent/last-escape-too-recent`), matched on its revert reason only.
 */
export const isEscapeTooRecentRevert = (error: unknown): boolean => {
  const text = error instanceof Error ? error.message : String(error);
  const lower = text.toLowerCase();
  return TOO_RECENT_REASONS.some((reason) => lower.includes(reason));
};

/**
 * Refuses an escape step the account's `assert_valid_escape_parameters` would
 * reject: it passes only when the block time is strictly after the last
 * attempt of that kind plus 12 hours — `last_owner_trigger_escape_attempt`
 * for `trigger_escape_guardian`, `last_owner_escape_attempt` for
 * `escape_guardian`. Read at the caller's pinned block; time only moves on, so
 * a step allowed there is allowed at inclusion. An unreadable clock refuses.
 */
export const requireEscapeAttemptAllowed = async (
  provider: RpcProvider,
  accountAddress: string,
  step: "complete" | "start",
  blockIdentifier: string,
): Promise<void> => {
  const entrypoint =
    step === "start" ? "get_last_owner_trigger_escape_attempt" : "get_last_owner_escape_attempt";
  const [lastAttempt, block] = await Promise.all([
    provider
      .callContract({ calldata: [], contractAddress: accountAddress, entrypoint }, blockIdentifier)
      .then(([value]) => value)
      .catch(() => undefined),
    provider.getBlock(blockIdentifier),
  ]);
  if (lastAttempt === undefined) {
    throw new WalletError(ESCAPE_LIMIT_UNCHECKED);
  }
  if (BigInt(block.timestamp) <= BigInt(lastAttempt) + ESCAPE_ATTEMPT_INTERVAL_SECONDS) {
    throw new WalletError(ESCAPE_TOO_RECENT);
  }
};
