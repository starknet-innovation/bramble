/**
 * Replies of the recovery-phrase flows, split from ./runtime-types by the size
 * budget: generating and checking a Starknet phrase, the two re-authenticated
 * reveals (`wallet.revealSecrets`, `wallet.revealQsbPhrase`), and the QSB
 * accounts that each hold a dedicated phrase. Only the generation reply and
 * the two reveals carry a phrase, and only to extension pages; a QSB account
 * reply carries `QsbAccountView`s, never a phrase or a journal id.
 */
import type { QsbAccountView } from "@bramble/wallet-model/qsb";

/**
 * Successful mnemonic-generation response.
 */
export type GenerateMnemonicResponse = {
  readonly mnemonic: string;
  readonly ok: true;
};

/**
 * Successful mnemonic-validity response. Carries only the boolean verdict.
 */
export type ValidateMnemonicResponse = {
  readonly ok: true;
  readonly valid: boolean;
};

/**
 * Re-authenticated secret reveal returned only to the extension reveal flow.
 */
export type RevealSecretsResponse = {
  readonly mnemonic: string | null;
  readonly ok: true;
  /** `null` on a network with no account: only the recovery phrase is revealed. */
  readonly privateKey: string | null;
};

/**
 * The QSB account replies: every account (`wallet.qsbAccounts`), the one
 * account a create, import or backup confirmation produced, and the one
 * phrase `wallet.revealQsbPhrase` returns after the password re-entered in
 * the request decrypted the vault.
 */
export type QsbAccountResponse =
  | { readonly accounts: readonly QsbAccountView[]; readonly ok: true }
  | { readonly account: QsbAccountView; readonly ok: true }
  | { readonly mnemonic: string; readonly ok: true };
