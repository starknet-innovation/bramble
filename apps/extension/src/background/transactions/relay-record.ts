/**
 * Records a SNIP-9 OutsideExecution the user signed for relay, for Activity
 * (issue 299). Called from the typed-data signing path only after the wallet
 * has signed it, so a refused or failed request records nothing.
 *
 * Best effort by design on the dapp path: a storage failure there must never
 * take back a signed message the user approved, so every error is absorbed.
 * A gasless execute is different. The row is written before the post, and a
 * failure there throws so the post does not happen.
 */

import { WalletError } from "@bramble/core/errors";
import { INVOKE_NOT_JOURNALED } from "@bramble/starknet/rpc-submit";
import { outsideExecutionTerms } from "@bramble/transactions/outside-execution-terms";
import type { RelaySignature, RelaySignatureLog } from "@bramble/transactions/relay-signatures";
import type { AccountContractType } from "@bramble/wallet-model/accounts";
import { type StarknetNetworkId, sameFelt } from "@bramble/wallet-model/networks";

/**
 * Account families whose outside-execution nonce view is known to answer for
 * every message revision they execute: Argent keeps one used-nonce map for v1
 * and v2 (vendored `outside_execution.cairo`), and OpenZeppelin's SRC9 supports
 * only v2. Braavos is not verified, so its rows are recorded but not tracked.
 */
const CHECKABLE_FAMILIES: ReadonlySet<AccountContractType> = new Set(["argent", "openzeppelin"]);

type RelayRecordInput = {
  readonly account: {
    readonly accountContractType: AccountContractType;
    readonly id: string;
    readonly networkId: StarknetNetworkId;
  };
  readonly messageHash: string;
  readonly origin: string;
  readonly typedData: unknown;
  readonly userFee?: {
    readonly amount: string;
    readonly decimals: number;
    readonly token: string;
  };
};

const recordedRelay = (
  input: RelayRecordInput,
  terms: NonNullable<ReturnType<typeof outsideExecutionTerms>>,
): Omit<RelaySignature, "checkedAt" | "signedAt" | "status"> => ({
  accountId: input.account.id,
  callCount: terms.callCount,
  checkable: CHECKABLE_FAMILIES.has(input.account.accountContractType),
  ...(terms.executeBefore === null ? {} : { executeBefore: terms.executeBefore }),
  messageHash: input.messageHash,
  networkId: input.account.networkId,
  nonce: terms.nonce,
  origin: input.origin,
  revision: terms.revision,
  ...(input.userFee ? { userFee: input.userFee } : {}),
});

/**
 * Records the signed message when `typedData` is a well-formed OutsideExecution
 * under the SNIP-9 domain; does nothing for any other message or when no log
 * is wired. Never throws.
 */
export const recordRelaySignature = async (
  log: Pick<RelaySignatureLog, "record"> | undefined,
  input: RelayRecordInput,
): Promise<void> => {
  // Everything after signing is inside the try: reading the untrusted typed
  // data or a log that throws synchronously must not keep the approved,
  // already signed message from reaching the dapp either.
  try {
    const terms = log ? outsideExecutionTerms(input.typedData) : null;
    if (!log || !terms) return;
    await log.record(recordedRelay(input, terms));
  } catch {
    // Absorbed by design; see the module comment.
  }
};

/**
 * Records a gasless outside execution before it is posted. Throws
 * {@link INVOKE_NOT_JOURNALED} when the row cannot be stored, including when
 * the log drops it, so the caller must not post.
 */
export const recordRequiredRelaySignature = async (
  log: Pick<RelaySignatureLog, "list" | "record"> | undefined,
  input: RelayRecordInput,
): Promise<void> => {
  const terms = log ? outsideExecutionTerms(input.typedData) : null;
  if (!log || !terms) {
    throw new WalletError(INVOKE_NOT_JOURNALED);
  }
  await log.record(recordedRelay(input, terms));
  const rows = await log.list({
    accountId: input.account.id,
    networkId: input.account.networkId,
  });
  if (!rows.some((row) => sameFelt(row.messageHash, input.messageHash))) {
    throw new WalletError(INVOKE_NOT_JOURNALED);
  }
};
