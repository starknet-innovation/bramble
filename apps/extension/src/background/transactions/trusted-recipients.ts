/**
 * The one background source of the address-poisoning check's extra trust
 * inputs (audit #163): the user's own accounts (vault accounts plus watched
 * shared accounts) and the recipients this wallet itself has paid.
 *
 * Every path that runs the shared recipient rule — the ERC20 and NFT sends, the
 * swap, dapp invokes, the STRK20 pool and dapp routes, and multisig review —
 * enriches its preferences here before calling `verificationContext`, so no
 * path judges a recipient against a narrower trusted set than another.
 *
 * Trust boundary: paid recipients come only from wallet-origin activity rows
 * (`walletPaidRecipients`); chain-discovered rows, which a third party can
 * plant, never enter the set. This module never touches the vault or the
 * session: callers pass public vault account addresses they read in a secret
 * boundary module (`vaultAccountAddresses` in runtime-state). Failure
 * behavior: an unreadable activity log or multisig registry contributes nothing, which leaves the check
 * exactly as strict as the address book alone — a storage fault can never
 * block a send nor add trust.
 */
import type { MultisigStore } from "@bramble/multisig/repository";
import type { ActivityLog } from "@bramble/transactions/activity";
import { type NetworkAddress, walletPaidRecipients } from "@bramble/transactions/paid-recipients";

/**
 * Collaborators the trust inputs are read from. The multisig registry is
 * optional because some handler dependency sets do not carry it.
 */
export type TrustedRecipientDeps = {
  readonly activity: Pick<ActivityLog, "list">;
  readonly multisigStore?: Pick<MultisigStore, "listMultisigs"> | undefined;
};

/**
 * The extra trust inputs `verificationContext` accepts beside preferences;
 * it network-filters them itself.
 */
export type TrustedRecipientSources = {
  readonly ownAccounts: readonly NetworkAddress[];
  readonly paidRecipients: readonly NetworkAddress[];
};

const asNetworkAddress = (entry: NetworkAddress): NetworkAddress => ({
  address: entry.address,
  networkId: entry.networkId,
});

/**
 * Returns `preferences` extended with the user's own accounts and paid
 * recipients. `vaultAccounts` are the vault accounts the caller already holds
 * (pass `[]` when none are available). Never throws.
 */
export const withTrustedRecipients = async <P extends object>(
  deps: TrustedRecipientDeps,
  preferences: P,
  vaultAccounts: readonly NetworkAddress[],
): Promise<P & TrustedRecipientSources> => {
  const [entries, multisigs] = await Promise.all([
    deps.activity.list().catch(() => []),
    deps.multisigStore ? deps.multisigStore.listMultisigs().catch(() => []) : [],
  ]);
  return {
    ...preferences,
    ownAccounts: [...vaultAccounts, ...multisigs].map(asNetworkAddress),
    paidRecipients: walletPaidRecipients(entries),
  };
};
