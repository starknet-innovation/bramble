/**
 * The single seam that picks a hash-signing backend for a resolved account,
 * shared by every submitting path — wallet transfers and account deploy,
 * multisig, dapp invoke/declare/private transfers, and SNIP-12 typed-data. It
 * branches on account KIND before any by-id vault lookup: a keyless Ledger
 * account routes to the panel/device queue wrapped in the
 * verify-before-broadcast gate ({@link ledgerStarkHashSigner}), while every
 * other account signs through the Krusty vault. A keyless Ledger account with
 * no queue wired throws, so a submit fails closed — never a silent vault
 * fallback and never an empty signature. Kept in one place so the choice can
 * never drift between the wallet-initiated and dapp-initiated flows.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { StarkHashSigner } from "@mc-wallet/starknet/provider";
import { type AccountRef, isLedgerAccount } from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";
import type { LedgerSignQueue } from "./ledger-sign-queue";
import { ledgerStarkHashSigner } from "./ledger-signer";

/**
 * Collaborators the account signer chooses between. `ledgerSignQueue` is
 * optional so partial test stubs and non-Ledger deployments stay valid; a
 * keyless Ledger account with no queue fails closed rather than falling through
 * to the vault. `session` is the live unlock session the signer was built
 * under: the vault path re-checks its boundary before and after each signature
 * so an explicit lock revokes in-flight signing, exactly as the Ledger queue
 * already does at settle time. It is required — an optional session would make
 * a caller that simply forgot it fail open, and every vault signature in the
 * extension is authorized by exactly one unlock. `wallet` supplies the
 * vault-backed hash signer for keyed accounts.
 */
export type AccountHashSignerDeps = {
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly session: PassiveUnlockSession;
  readonly wallet: Pick<WalletStatusReader, "signHash">;
};

/**
 * Builds the {@link StarkHashSigner} for a resolved account without exposing any
 * vault secret to the caller. A keyless Ledger account is signed on the device
 * (via the queue) and verified against its stored `publicKeyX`; any other
 * account signs through the vault. Throws `WalletError` up front for a keyless
 * Ledger account with no queue wired, so the submit aborts with nothing sent.
 *
 * A vault signature is bound to the unlock session that authorized it: the
 * session boundary captured here is re-checked before the vault is touched and
 * again before the signature is handed back, so a lock or expiry between
 * approval and broadcast rejects with `wallet locked` instead of completing a
 * transaction the user believes they revoked.
 */
export const accountHashSigner = (
  deps: AccountHashSignerDeps,
  account: AccountRef,
  vaultPassphrase: string,
): StarkHashSigner => {
  if (isLedgerAccount(account)) {
    const queue = deps.ledgerSignQueue;
    if (!queue) {
      throw new WalletError("Ledger signing unavailable");
    }
    return ledgerStarkHashSigner(account, (request) => queue.request(request));
  }
  const authorized = captureSessionAuthorization(deps.session);
  const requireLiveSession = (): void => {
    if (!authorized.isCurrent()) {
      throw new WalletError("wallet locked");
    }
  };
  return async (messageHash) => {
    requireLiveSession();
    const signed = await deps.wallet.signHash({
      accountId: account.id,
      messageHash,
      vaultPassphrase,
    });
    requireLiveSession();
    if (!sameFelt(signed.publicKey, account.publicKeyX)) {
      throw new WalletError("Krusty KMS signature key mismatch");
    }
    return { kind: "stark", ...signed };
  };
};
