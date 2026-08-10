/**
 * Vault-only STRK20 viewing-key derivation boundary.
 */
import type { KrustyKms, StarkSignature } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { canonicalFelt } from "../starknet/networks";
import {
  LEDGER_STRK20_VIEWING_KEY_SCHEME,
  type LedgerStrk20Scope,
  ledgerStrk20ScopeFor,
  ledgerStrk20ViewingKeyFor,
  withLedgerStrk20ViewingKey,
} from "../storage/vault-account-secrets";
import { isKeylessAccount, type Vault } from "../storage/vault-schema";
import { findVaultAccount } from "./vault-account";

/**
 * Raised when a Ledger account has no retained viewing key for the exact scope
 * asked for. Exported so callers can tell this recoverable state — the user has
 * simply not run the device ceremony for this pool yet — apart from a genuine
 * failure, without matching a message literal. Compare against it; never rebuild
 * the string (see {@link isLedgerStrk20ViewingKeyMissing}).
 */
export const LEDGER_STRK20_VIEWING_KEY_UNAVAILABLE = "Ledger STRK20 viewing key unavailable";

/**
 * True when a thrown error is the recoverable "device ceremony not yet run for
 * this scope" state rather than a real failure. Callers use this to offer the
 * ceremony instead of surfacing an error.
 */
export const isLedgerStrk20ViewingKeyMissing = (error: unknown): boolean =>
  error instanceof WalletError && error.message === LEDGER_STRK20_VIEWING_KEY_UNAVAILABLE;

/**
 * Resolves a domain-separated privacy viewing key without exposing it beyond
 * the privileged vault boundary. Software accounts derive through Krusty;
 * Ledger accounts use only an exact chain/pool-scoped retained key.
 */
export const deriveVaultStrk20ViewingKey = async (
  kms: KrustyKms,
  vault: Vault,
  accountId: string,
  chainId: string,
  poolAddress: string,
): Promise<string> => {
  const account = findVaultAccount(vault, accountId);
  if (isKeylessAccount(account)) {
    const viewingKey = ledgerStrk20ViewingKeyFor(
      vault.accountSecrets,
      account.id,
      chainId,
      poolAddress,
    );
    if (!viewingKey) {
      throw new WalletError(LEDGER_STRK20_VIEWING_KEY_UNAVAILABLE);
    }
    return viewingKey;
  }
  const signingKey = vault.signingKeys.find((key) => key.accountId === account.id);
  if (!signingKey) {
    throw new WalletError("Signing key unavailable");
  }
  return kms.deriveStrk20ViewingKey(signingKey.privateKey, chainId, poolAddress);
};

/**
 * A folded viewing key waiting to be written, with the scope it is bound to.
 */
export type PreparedLedgerStrk20ViewingKey = {
  readonly accountId: string;
  readonly scope: LedgerStrk20Scope;
  readonly viewingKey: string;
};

/**
 * Runs the device half of the Ledger viewing-key ceremony.
 *
 * The device cannot reveal its private key, so the wallet performs the two
 * hashing stages either side of the signature itself: it asks Krusty for the
 * exact message the software derivation would have signed, hands that to the
 * device through `sign`, and folds the returned `(r, s)` into the key. The result
 * is therefore the same key a host-held key of that account would produce, up to
 * the device's RFC-6979 variant.
 *
 * `sign` is injected rather than called here so the device round-trip — and its
 * verify-against-`publicKeyX` gate — stays in the caller that owns the transport.
 *
 * This stage deliberately performs NO write and must not be run while holding the
 * vault's mutation lock: `sign` waits on a human confirming on hardware, and the
 * surface that drives that hardware needs to read the vault to render. Holding
 * the lock across it deadlocks the wallet. {@link withLedgerStrk20CeremonyKey}
 * applies the result under the lock against a freshly read vault.
 *
 * Fails closed on a software account, a scope that does not belong to the
 * account's network, a non-canonical scope, or a key the fold cannot produce in
 * range.
 */
export const prepareLedgerStrk20ViewingKey = async (
  kms: KrustyKms,
  vault: Vault,
  input: {
    readonly accountId: string;
    readonly chainId: string;
    readonly poolAddress: string;
    readonly sign: (messageHash: string) => Promise<StarkSignature>;
  },
): Promise<PreparedLedgerStrk20ViewingKey> => {
  const account = findVaultAccount(vault, input.accountId);
  if (!isKeylessAccount(account)) {
    throw new WalletError("Account is not a Ledger account");
  }
  const scope = ledgerStrk20ScopeFor(account, input.chainId, input.poolAddress);
  if (!scope) {
    throw new WalletError("Invalid Ledger STRK20 viewing-key scope");
  }
  const messageHash = await kms.strk20ViewingKeyMessageHash(scope.chainId, scope.poolAddress);
  const signature = await input.sign(messageHash);
  const viewingKey = canonicalFelt(await kms.foldStrk20ViewingKey(signature.r, signature.s));
  if (!viewingKey) {
    throw new WalletError("Invalid Ledger STRK20 viewing key");
  }
  return { accountId: account.id, scope, viewingKey };
};

/**
 * Applies a prepared viewing key to a vault, returning the vault to persist.
 *
 * Takes the vault as an argument rather than closing over the one the ceremony
 * started from, so the caller can re-read inside the mutation lock and not
 * clobber a write that landed while the device was being confirmed. The account
 * binding is re-checked by the vault validator at write time, so an account
 * removed mid-ceremony fails closed instead of retaining an orphan secret.
 */
export const withLedgerStrk20CeremonyKey = (
  vault: Vault,
  prepared: PreparedLedgerStrk20ViewingKey,
): Vault => {
  const accountSecrets = withLedgerStrk20ViewingKey(vault.accountSecrets, {
    accountId: prepared.accountId,
    ledgerStrk20ViewingKeys: [
      {
        ...prepared.scope,
        scheme: LEDGER_STRK20_VIEWING_KEY_SCHEME,
        viewingKey: prepared.viewingKey,
      },
    ],
  });
  if (!accountSecrets) {
    throw new WalletError("Ledger STRK20 viewing-key limit reached");
  }
  return { ...vault, accountSecrets };
};

/**
 * Runs the whole Ledger viewing-key ceremony, in the one order that is safe.
 *
 * The ordering is the point, which is why it lives here rather than at the call
 * site: `sign` waits on a human confirming on hardware, and the surface that
 * drives that hardware has to read the vault to render itself. Holding the
 * vault's mutation lock across the device round-trip therefore deadlocks the
 * wallet — the ceremony waits for the panel, the panel waits for the lock.
 *
 * So the device half runs unlocked, and only the write is serialized, against a
 * vault re-read inside the lock so a mutation that landed mid-ceremony is not
 * clobbered. A refused or unverifiable signature throws before the lock is ever
 * taken, leaving storage untouched.
 */
export const runLedgerStrk20ViewingKeyCeremony = async (
  kms: KrustyKms,
  input: {
    readonly accountId: string;
    readonly chainId: string;
    readonly poolAddress: string;
    readonly sign: (messageHash: string) => Promise<StarkSignature>;
  },
  io: {
    readonly readVault: () => Promise<Vault>;
    readonly serialized: (run: () => Promise<void>) => Promise<void>;
    readonly writeVault: (vault: Vault) => Promise<void>;
  },
): Promise<void> => {
  const prepared = await prepareLedgerStrk20ViewingKey(kms, await io.readVault(), input);
  await io.serialized(async () => {
    await io.writeVault(withLedgerStrk20CeremonyKey(await io.readVault(), prepared));
  });
};
