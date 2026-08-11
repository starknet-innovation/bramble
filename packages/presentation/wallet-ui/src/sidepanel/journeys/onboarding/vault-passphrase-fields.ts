/**
 * The vault-passphrase pair on the setup form: whether it is acceptable, and the
 * inline copy that says why not.
 *
 * Split from ./onboarding-ui for the file-size budget, and it stands alone
 * cleanly: the rule is a length invariant owned by the encrypted store plus an
 * exact match between the two fields, with no dependence on the rest of setup.
 *
 * Holds no secret beyond the field values it reads to compare them, which are
 * never stored, logged, or returned.
 */

import { isVaultPassphrase } from "@mc-wallet/wallet-model/passphrase";

/**
 * The passphrase fields' current state, as setup needs to render it.
 */
export type VaultPassphraseState = {
  /** Inline hint under the confirmation field; empty when both fields agree. */
  readonly confirmationHint: string;
  /** True when the passphrase is long enough and both fields match exactly. */
  readonly ok: boolean;
  /** The requirement line's text. */
  readonly requirement: string;
  /** True when the requirement line should read as satisfied. */
  readonly satisfied: boolean;
};

/**
 * Reads the two fields and reports whether the pair is acceptable, with the copy
 * for each hint.
 *
 * The length rule comes from {@link isVaultPassphrase} rather than a local
 * constant, so this can never disagree with what the encrypted store will accept
 * when the vault is actually written.
 */
export const vaultPassphraseState = (
  passphrase: string,
  confirmation: string,
): VaultPassphraseState => {
  const validLength = isVaultPassphrase(passphrase);
  const matches = passphrase === confirmation && confirmation.length > 0;
  return {
    confirmationHint:
      confirmation.length > 0 && !matches ? "Enter the same passphrase in both fields." : "",
    ok: validLength && passphrase === confirmation,
    requirement: !validLength
      ? "Enter at least 12 characters"
      : matches
        ? "Passphrases match"
        : "Passphrases do not match",
    satisfied: validLength && matches,
  };
};
