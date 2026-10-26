/**
 * Records a SNIP-9 OutsideExecution the user signed for relay, for Activity
 * (issue 299). Called from the typed-data signing path only after the wallet
 * has signed it, so a refused or failed request records nothing.
 *
 * Best effort by design: a storage failure here must never take back a
 * signed message the user approved, so every error is absorbed.
 */

import { outsideExecutionTerms } from "@bramble/transactions/outside-execution-terms";
import type { RelaySignatureLog } from "@bramble/transactions/relay-signatures";
import type { AccountContractType } from "@bramble/wallet-model/accounts";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";

/**
 * Account families whose outside-execution nonce view is known to answer for
 * every message revision they execute: Argent keeps one used-nonce map for v1
 * and v2 (vendored `outside_execution.cairo`), and OpenZeppelin's SRC9 supports
 * only v2. Braavos is not verified, so its rows are recorded but not tracked.
 */
const CHECKABLE_FAMILIES: ReadonlySet<AccountContractType> = new Set(["argent", "openzeppelin"]);

/**
 * Records the signed message when `typedData` is a well-formed OutsideExecution
 * under the SNIP-9 domain; does nothing for any other message or when no log
 * is wired. Never throws.
 */
export const recordRelaySignature = async (
  log: Pick<RelaySignatureLog, "record"> | undefined,
  input: {
    readonly account: {
      readonly accountContractType: AccountContractType;
      readonly id: string;
      readonly networkId: StarknetNetworkId;
    };
    readonly messageHash: string;
    readonly origin: string;
    readonly typedData: unknown;
  },
): Promise<void> => {
  const terms = log ? outsideExecutionTerms(input.typedData) : null;
  if (!log || !terms) return;
  await log
    .record({
      accountId: input.account.id,
      callCount: terms.callCount,
      checkable: CHECKABLE_FAMILIES.has(input.account.accountContractType),
      ...(terms.executeBefore === null ? {} : { executeBefore: terms.executeBefore }),
      messageHash: input.messageHash,
      networkId: input.account.networkId,
      nonce: terms.nonce,
      origin: input.origin,
      revision: terms.revision,
    })
    .catch(() => undefined);
};
