/**
 * Hardware viewing-key custody at the wallet-owned STRK20 boundary: whether an
 * account still needs the device ceremony, and the disclosure shown when
 * registering will retain a key on disk. Split from strk20-wallet-ops.ts by
 * behavior to keep both inside the size budget.
 */

import { isLedgerStrk20ViewingKeyMissing } from "@mc-wallet/vault/strk20-viewing-key";
import type { ActivePrivacyContext } from "./strk20-op-context";

/**
 * Whether this account still needs the device ceremony before any private read.
 *
 * Only a keyless Ledger account can: a software account's key is always derivable
 * from its signing key. That guard is load-bearing, not an optimization — probing
 * resolves the key, so probing unconditionally would make every state read depend
 * on the key even when no balance is read, turning a working read into a failure
 * whenever derivation is unavailable.
 *
 * Resolving it is the only honest test, since presence is a vault fact no pool or
 * indexer can answer. The value is discarded immediately: it stays inside the
 * background boundary and is never returned, stored, or logged.
 *
 * Rethrows anything that is not the recoverable missing-key state, so a genuine
 * derivation failure fails the caller instead of reading as "needs setup".
 */
export const needsViewingKeyCeremony = async (context: ActivePrivacyContext): Promise<boolean> => {
  if (context.accountContext.account.derivation.kind !== "ledger") {
    return false;
  }
  try {
    await context.accountContext.viewingKey();
    return false;
  } catch (error) {
    if (isLedgerStrk20ViewingKeyMissing(error)) {
      return true;
    }
    throw error;
  }
};

/**
 * Custody disclosure shown when registering will retain a viewing key on disk.
 *
 * Exported because it is user-facing security copy: a test pins that the
 * registration review carries it, so it cannot be dropped by accident.
 */
export const STRK20_VIEWING_KEY_CUSTODY_DISCLOSURE =
  "Registering stores a viewing key on disk for ease of use. It is encrypted with your wallet password, like every other secret this wallet holds, and cannot be read without it.";

/**
 * The custody disclosure lines for one account's registration review, empty when
 * nothing will be retained.
 *
 * Disclosed only for a keyless account, because only a keyless account retains the
 * key. A software account's viewing key is derived on demand and never persisted,
 * so telling that user their key is stored on disk would be false.
 *
 * The comparison is to "every other secret this wallet holds" rather than to the
 * recovery phrase on purpose: a Ledger-created vault holds no phrase at all
 * (createLedgerVault writes `mnemonic: null`), and those are exactly the accounts
 * this line is shown for — so a phrase comparison would break precisely where the
 * statement applies.
 */
export const viewingKeyCustodyDisclosure = (context: ActivePrivacyContext): readonly string[] =>
  context.accountContext.account.derivation.kind === "ledger"
    ? [STRK20_VIEWING_KEY_CUSTODY_DISCLOSURE]
    : [];
