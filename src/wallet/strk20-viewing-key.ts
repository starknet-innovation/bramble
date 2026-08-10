/**
 * Vault-only STRK20 viewing-key derivation boundary.
 */
import type { KrustyKms, StarkSignature } from "../crypto/krusty";
import { WalletError } from "../shared/errors";
import { canonicalFelt } from "../starknet/networks";
import {
  LEDGER_STRK20_VIEWING_KEY_SCHEME,
  ledgerStrk20ScopeFor,
  ledgerStrk20ViewingKeyFor,
  withLedgerStrk20ViewingKey,
} from "../storage/vault-account-secrets";
import { isKeylessAccount, type Vault } from "../storage/vault-schema";
import { findVaultAccount } from "./vault-account";

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
      throw new WalletError("Ledger STRK20 viewing key unavailable");
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
 * Runs the Ledger viewing-key ceremony and returns the vault to persist.
 *
 * The device cannot reveal its private key, so the wallet performs the two
 * hashing stages either side of the signature itself: it asks Krusty for the
 * exact message the software derivation would have signed, hands that to the
 * device through `sign`, and folds the returned `(r, s)` into the key. The result
 * is therefore the same key a host-held key of that account would produce, up to
 * the device's RFC-6979 variant.
 *
 * `sign` is injected rather than called here so the device round-trip — and its
 * verify-against-`publicKeyX` gate — stays in the caller that owns the
 * transport, while the key itself is folded and written without ever leaving this
 * privileged boundary. Nothing partial is persisted: the caller receives a whole
 * vault to write, so a rejected or unverifiable signature leaves storage
 * untouched.
 *
 * Fails closed on a software account, a scope that does not belong to the
 * account's network, a non-canonical scope, or a key the fold cannot produce in
 * range.
 */
export const ledgerStrk20ViewingKeyCeremony = async (
  kms: KrustyKms,
  vault: Vault,
  input: {
    readonly accountId: string;
    readonly chainId: string;
    readonly poolAddress: string;
    readonly sign: (messageHash: string) => Promise<StarkSignature>;
  },
): Promise<Vault> => {
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
  const accountSecrets = withLedgerStrk20ViewingKey(vault.accountSecrets, {
    accountId: account.id,
    ledgerStrk20ViewingKeys: [{ ...scope, scheme: LEDGER_STRK20_VIEWING_KEY_SCHEME, viewingKey }],
  });
  if (!accountSecrets) {
    throw new WalletError("Ledger STRK20 viewing-key limit reached");
  }
  return { ...vault, accountSecrets };
};
