/**
 * The single seam that picks a hash-signing backend for a resolved account,
 * shared by every submitting path — wallet transfers and account deploy,
 * multisig, dapp invoke/declare/private transfers, and SNIP-12 typed-data. It
 * branches on account KIND before any by-id vault lookup: a keyless account
 * routes to the panel/device queue for its device wrapped in the
 * verify-before-broadcast gate ({@link ledgerStarkHashSigner} for a Ledger,
 * {@link mobilePqHashSigner} for a paired phone), while every other account signs
 * through the Krusty vault. A keyless account whose queue is not wired throws, so
 * a submit fails closed — never a silent vault fallback and never an empty
 * signature. Kept in one place so the choice can never drift between the
 * wallet-initiated and dapp-initiated flows.
 */

import { WalletError } from "@mc-wallet/core/errors";
import type { AccountHashSigner } from "@mc-wallet/starknet/provider";
import {
  type AccountRef,
  isKeylessAccount,
  isLedgerAccount,
} from "@mc-wallet/wallet-model/accounts";
import { sameFelt } from "@mc-wallet/wallet-model/networks";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import type { DeviceEnrollment, DeviceSignQueues } from "../devices/device-queues";
import { mobilePqHashSigner } from "../devices/mobile-pq-signer";
import { captureSessionAuthorization, type PassiveUnlockSession } from "../runtime/session";
import { ledgerStarkHashSigner } from "./ledger-signer";

/**
 * Collaborators the account signer chooses between. Each device queue is
 * optional so partial test stubs and deployments without that device stay valid;
 * a keyless account whose queue is absent fails closed rather than falling
 * through to the vault. `session` is the live unlock session the signer was built
 * under: the vault path re-checks its boundary before and after each signature
 * so an explicit lock revokes in-flight signing, exactly as the Ledger queue
 * already does at settle time. It is required — an optional session would make
 * a caller that simply forgot it fail open, and every vault signature in the
 * extension is authorized by exactly one unlock. `wallet` supplies the
 * vault-backed hash signer for keyed accounts.
 */
export type AccountHashSignerDeps = DeviceSignQueues &
  DeviceEnrollment & {
    readonly session: PassiveUnlockSession;
    readonly wallet: Pick<WalletStatusReader, "signHash">;
  };

/**
 * Builds the {@link AccountHashSigner} for a resolved account without exposing any
 * vault secret to the caller. A keyless account is signed on its device (via
 * that device's queue) and verified against the key the account enrolled — a
 * Ledger against `publicKeyX`, a paired phone against its ML-DSA `publicKey`;
 * any other account signs through the vault. Throws `WalletError` up front for a
 * keyless account with no queue wired, so the submit aborts with nothing sent.
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
): AccountHashSigner => {
  if (isLedgerAccount(account)) {
    const queue = deps.ledgerSignQueue;
    if (!queue) {
      throw new WalletError("Ledger signing unavailable");
    }
    return ledgerStarkHashSigner(account, (request) => queue.request(request));
  }
  if (isKeylessAccount(account)) {
    const queue = deps.mobilePqSignQueue;
    const mlDsa = deps.mlDsa;
    if (!queue || !mlDsa) {
      throw new WalletError("Mobile signing unavailable");
    }
    return mobilePqHashSigner(account, (request) => queue.request(request), mlDsa.mlDsaVerify);
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
