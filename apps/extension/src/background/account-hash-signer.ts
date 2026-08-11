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
import { type AccountRef, isKeylessAccount } from "@mc-wallet/wallet-model/accounts";
import type { StarkHashSigner } from "@mc-wallet/starknet/provider";
import type { LedgerSignQueue } from "./ledger-sign-queue";
import { ledgerStarkHashSigner } from "./ledger-signer";
import type { WalletStatusReader } from "./wallet-reader";

/**
 * Collaborators the account signer chooses between. `ledgerSignQueue` is
 * optional so partial test stubs and non-Ledger deployments stay valid; a
 * keyless Ledger account with no queue fails closed rather than falling through
 * to the vault. `wallet` supplies the vault-backed hash signer for keyed
 * accounts.
 */
export type AccountHashSignerDeps = {
  readonly ledgerSignQueue?: LedgerSignQueue;
  readonly wallet: Pick<WalletStatusReader, "signHash">;
};

/**
 * Builds the {@link StarkHashSigner} for a resolved account without exposing any
 * vault secret to the caller. A keyless Ledger account is signed on the device
 * (via the queue) and verified against its stored `publicKeyX`; any other
 * account signs through the vault. Throws `WalletError` up front for a keyless
 * Ledger account with no queue wired, so the submit aborts with nothing sent.
 */
export const accountHashSigner = (
  deps: AccountHashSignerDeps,
  account: AccountRef,
  vaultPassphrase: string,
): StarkHashSigner => {
  if (isKeylessAccount(account)) {
    const queue = deps.ledgerSignQueue;
    if (!queue) {
      throw new WalletError("Ledger signing unavailable");
    }
    return ledgerStarkHashSigner(account, (request) => queue.request(request));
  }
  return (messageHash) =>
    deps.wallet.signHash({ accountId: account.id, messageHash, vaultPassphrase });
};
