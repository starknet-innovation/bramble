/**
 * Shared background status helpers for wallet runtime messages.
 */

import { WalletError } from "@bramble/core/errors";
import type { WalletPreferences, WalletPreferencesStore } from "@bramble/settings/preferences";
import { serializeStoreMutations } from "@bramble/store/mutation";
import type { Vault } from "@bramble/vault/schema";
import { findVaultAccount } from "@bramble/vault/vault-account";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import {
  STARKNET_NETWORKS,
  type StarknetNetwork,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import type { NetworkOption, WalletStatus } from "@bramble/wallet-protocol/extension-responses";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { runGuardedNetworkMutation } from "./active-network-mutation";
import {
  captureSessionAuthorization,
  type PassiveUnlockSession,
  type UnlockSession,
} from "./session";

const networkOptions = (): readonly NetworkOption[] =>
  Object.values(STARKNET_NETWORKS).map((network) => ({
    id: network.id,
    name: network.name,
  }));

/**
 * Re-exported fallback preferences store so callers keep one import path.
 */
export { unavailablePreferencesStore } from "./unavailable-preferences-store";

/**
 * Ordered RPC endpoints for a network, preferring the user's custom override
 * as the default and keeping built-in endpoints as fallback.
 */
export const networkRpcUrls = (
  network: StarknetNetwork,
  preferences: WalletPreferences,
): readonly string[] => {
  const override = preferences.rpcOverrides?.[network.id];
  return override ? [override, ...network.rpcUrls] : network.rpcUrls;
};

/**
 * Returns the active account for a network, falling back to the first account
 * on that network the user has not hidden, and only then to the first at all.
 * This is the account `wallet.status` reports as active.
 */
export const accountForNetwork = (
  vault: Vault,
  networkId: StarknetNetworkId,
  accountId: string | null | undefined,
  hiddenAccountIds: readonly string[] = [],
): AccountRef | null =>
  vault.accounts.find((account) => account.id === accountId && account.networkId === networkId) ??
  vault.accounts.find(
    (account) => account.networkId === networkId && !hiddenAccountIds.includes(account.id),
  ) ??
  vault.accounts.find((account) => account.networkId === networkId) ??
  null;

/**
 * Serializes the cross-store mutations that jointly define the selected
 * network and account. It is worker-local: durable interruption recovery is
 * still provided by preference-first ordering plus reconciliation.
 */
export type ActiveStateCoordinator = {
  readonly run: <T>(operation: () => Promise<T>) => Promise<T>;
};

/**
 * Creates one active-state coordinator for the background worker. Failed
 * operations reject their caller without poisoning later queued mutations.
 */
export const createActiveStateCoordinator = (): ActiveStateCoordinator =>
  serializeStoreMutations<ActiveStateCoordinator>(
    {
      run(operation) {
        return operation();
      },
    },
    [],
  );

/**
 * Runs an active-state mutation through the production coordinator when one
 * is supplied. The direct fallback keeps isolated helper tests and explicitly
 * partial consumers usable; the wired runtime always supplies one instance.
 */
export const runActiveStateMutation = <T>(
  coordinator: ActiveStateCoordinator | undefined,
  operation: () => Promise<T>,
): Promise<T> => (coordinator ? coordinator.run(operation) : operation());

const reconcileActiveAccountWithGuard = async (
  wallet: WalletStatusReader,
  preferencesStore: WalletPreferencesStore,
  vaultPassphrase: string,
  canCommit: () => boolean,
): Promise<AccountRef | null> => {
  const [preferences, vault] = await Promise.all([
    preferencesStore.read(),
    wallet.readVault(vaultPassphrase),
  ]);
  const account = accountForNetwork(
    vault,
    preferences.activeNetworkId,
    vault.activeAccountId,
    preferences.hiddenAccountIds,
  );
  if (!account || account.id === vault.activeAccountId) {
    return account;
  }
  if (!canCommit()) {
    throw new WalletError("Unlock session changed during account reconciliation");
  }
  return wallet.setActiveAccount({ accountId: account.id, vaultPassphrase });
};

/**
 * Repairs the encrypted active-account pointer after a browser update, locked
 * network switch, or interrupted cross-store switch. The caller supplies an
 * already authenticated passphrase; if the selected network has an account,
 * the mutation is serialized by the vault service and otherwise no account is
 * created implicitly.
 */
export const reconcileActiveAccount = async (
  wallet: WalletStatusReader,
  preferencesStore: WalletPreferencesStore,
  vaultPassphrase: string,
  coordinator?: ActiveStateCoordinator,
): Promise<AccountRef | null> =>
  runActiveStateMutation(coordinator, () =>
    reconcileActiveAccountWithGuard(wallet, preferencesStore, vaultPassphrase, () => true),
  );

/**
 * Reconciles the active account for a restored or preference-mutated unlocked
 * session without renewing its inactivity timer. A read or write failure locks
 * only the session generation that authorized the repair; a replacement unlock
 * is never cleared by stale work, and no mutation starts after that generation
 * changes.
 */
export const reconcileUnlockedActiveAccount = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  coordinator?: ActiveStateCoordinator,
): Promise<AccountRef | null> => {
  const generation = session.generation();
  const vaultPassphrase = session.peekPassphrase();
  if (!vaultPassphrase) {
    return null;
  }
  const authorized = captureSessionAuthorization(session).isCurrent;
  try {
    return await runActiveStateMutation(coordinator, () =>
      reconcileActiveAccountWithGuard(wallet, preferencesStore, vaultPassphrase, authorized),
    );
  } catch {
    if (session.generation() === generation) {
      session.lock();
    }
    return null;
  }
};

const requireCurrentNetworkSwitch = (authorized: () => boolean): void => {
  if (!authorized()) {
    throw new WalletError("Unlock session changed during network switch");
  }
};

const requireCurrentAccountSelection = (authorized: () => boolean): void => {
  if (!authorized()) {
    throw new WalletError("Unlock session changed during account selection");
  }
};

/**
 * Selects an existing account and its network as one fail-closed cross-store
 * mutation. The plain network preference records intent first; any subsequent
 * failure locks only the session generation that authorized the operation so
 * the provider cannot expose a different account under the new network.
 *
 * The caller must already hold the active-state coordinator (or be the only
 * writer): this does not take it, so a composite operation can switch inside
 * one serialized section instead of nesting coordinator runs.
 */
export const selectAccountLocked = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  accountId: string,
): Promise<AccountRef | null> => {
  const passphrase = session.getPassphrase();
  if (!passphrase) {
    return null;
  }
  const generation = session.generation();
  const authorized = captureSessionAuthorization(session).isCurrent;
  const target = findVaultAccount(await wallet.readVault(passphrase), accountId);
  requireCurrentAccountSelection(authorized);
  return runGuardedNetworkMutation(
    session,
    preferencesStore,
    target.networkId,
    passphrase,
    generation,
    "Unlock session changed during account selection",
    (vaultPassphrase) => wallet.setActiveAccount({ accountId, vaultPassphrase }),
  );
};

/**
 * Reads the vault under the session's current credential, or null when the
 * session holds none. Kept in this boundary module so the session and vault
 * accessors are named in one audited place; callers pass the returned vault
 * around and never the credential.
 */
export const readUnlockedVault = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
): Promise<Vault | null> => {
  const passphrase = session.getPassphrase();
  return passphrase ? wallet.readVault(passphrase) : null;
};

/**
 * Selects an existing account and its network, serialized on the active-state
 * coordinator. See {@link selectAccountLocked} for the mutation itself.
 */
export const selectActiveAccount = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  accountId: string,
  coordinator?: ActiveStateCoordinator,
): Promise<AccountRef | null> =>
  runActiveStateMutation(coordinator, () =>
    selectAccountLocked(wallet, session, preferencesStore, accountId),
  );

const selectNetworkAccount = async (
  wallet: WalletStatusReader,
  networkId: StarknetNetworkId,
  passphrase: string,
  authorized: () => boolean,
  hiddenAccountIds: readonly string[],
  preferredAccountId?: string,
): Promise<AccountRef | null> => {
  const vault = await wallet.readVault(passphrase);
  requireCurrentNetworkSwitch(authorized);
  const fallback = accountForNetwork(vault, networkId, vault.activeAccountId, hiddenAccountIds);
  if (fallback?.id === vault.activeAccountId) {
    return fallback;
  }
  // A preferred account wins over "first on the network" only when it really
  // is a vault account on the target network; anything else is ignored.
  const account =
    vault.accounts.find(
      (stored) => stored.id === preferredAccountId && stored.networkId === networkId,
    ) ?? fallback;
  if (account) {
    const selected = await wallet.setActiveAccount({
      accountId: account.id,
      vaultPassphrase: passphrase,
    });
    requireCurrentNetworkSwitch(authorized);
    return selected;
  }
  if (vault.accounts.length === 0) {
    return null;
  }
  const selected = await wallet.ensureNetworkAccount({
    networkId,
    vaultPassphrase: passphrase,
  });
  requireCurrentNetworkSwitch(authorized);
  return selected;
};

/**
 * Switches the active network and selects or derives the matching wallet account.
 * When the vault's active account is not on the target network, an optional
 * `preferredAccountId` on that network is selected ahead of the first account
 * there (a dapp switch lands on an account the origin already holds); an id
 * that is unknown or on another network is ignored.
 */
export const switchActiveNetwork = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  networkId: StarknetNetworkId,
  coordinator?: ActiveStateCoordinator,
  options: { readonly preferredAccountId?: string } = {},
): Promise<AccountRef | null> =>
  runActiveStateMutation(coordinator, async () => {
    // The plain preference is the durable selection intent. Writing it first
    // means a failed vault write can be retried/reconciled without creating a
    // hidden account that makes the user's retry fail as a duplicate.
    const passphrase = session.getPassphrase();
    if (!passphrase) {
      await preferencesStore.setActiveNetwork(networkId);
      return null;
    }
    const generation = session.generation();
    const authorized = captureSessionAuthorization(session).isCurrent;
    const { hiddenAccountIds = [] } = await preferencesStore.read();
    return runGuardedNetworkMutation(
      session,
      preferencesStore,
      networkId,
      passphrase,
      generation,
      "Unlock session changed during network switch",
      (vaultPassphrase) =>
        selectNetworkAccount(
          wallet,
          networkId,
          vaultPassphrase,
          authorized,
          hiddenAccountIds,
          options.preferredAccountId,
        ),
    );
  });

/**
 * The active account resolved behind an unlocked session, or the error response
 * to return when it cannot be resolved.
 */
export type ActiveAccountContext =
  | { readonly error: string }
  | {
      readonly account: AccountRef;
      /** Public account metadata available to privileged wallet operations. */
      readonly accounts: readonly AccountRef[];
      readonly error?: never;
      readonly networkId: StarknetNetworkId;
      readonly vaultPassphrase: string;
    };

const accountContextFor = async (
  wallet: WalletStatusReader,
  vaultPassphrase: string | null,
  preferencesStore: WalletPreferencesStore,
): Promise<ActiveAccountContext> => {
  if (!vaultPassphrase) {
    return { error: "wallet locked" };
  }
  const preferences = await preferencesStore.read();
  const vault = await wallet.readVault(vaultPassphrase);
  const account = accountForNetwork(
    vault,
    preferences.activeNetworkId,
    vault.activeAccountId,
    preferences.hiddenAccountIds,
  );
  if (!account) {
    return { error: "no account for selected network" };
  }
  return {
    account,
    accounts: vault.accounts,
    networkId: preferences.activeNetworkId,
    vaultPassphrase,
  };
};

/**
 * Resolves the active network account for an operation the user just initiated
 * from an extension page, renewing the inactivity window as it reads the
 * passphrase. Never use it on traffic that arrives on a cadence the user does
 * not control — that is what {@link observedAccountContext} is for.
 */
export const activeAccountContext = (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
): Promise<ActiveAccountContext> =>
  accountContextFor(wallet, session.getPassphrase(), preferencesStore);

/**
 * Resolves the active network account without extending the unlock lifetime.
 * It takes the non-renewing half of the session, so a handler wired to ambient
 * traffic — panel polling, dapp queries, background reconciliation — cannot
 * hold the wallet unlocked no matter which session value it is handed.
 */
export const observedAccountContext = (
  wallet: WalletStatusReader,
  session: PassiveUnlockSession,
  preferencesStore: WalletPreferencesStore,
): Promise<ActiveAccountContext> =>
  accountContextFor(wallet, session.peekPassphrase(), preferencesStore);

/** The public half of a vault account: what the poisoning check trusts. */
export type VaultAccountAddress = Pick<AccountRef, "address" | "networkId">;

/**
 * Reads the vault's public account addresses with a passphrase the caller
 * already holds, for the address-poisoning trust set (audit #163). Only
 * `address` and `networkId` leave this boundary module; a failed read yields
 * `[]`, which leaves the check as strict as the address book alone.
 */
export const vaultAccountAddresses = async (
  wallet: Pick<WalletStatusReader, "readVault">,
  passphrase: string,
): Promise<readonly VaultAccountAddress[]> => {
  try {
    return (await wallet.readVault(passphrase)).accounts.map(({ address, networkId }) => ({
      address,
      networkId,
    }));
  } catch {
    return [];
  }
};

/**
 * {@link vaultAccountAddresses} for callers that hold no passphrase. Reads it
 * through the non-renewing session view, so the read never extends the unlock
 * period; a locked wallet yields `[]`.
 */
export const observedVaultAccountAddresses = (
  wallet: Pick<WalletStatusReader, "readVault">,
  session: Pick<PassiveUnlockSession, "peekPassphrase">,
): Promise<readonly VaultAccountAddress[]> => {
  const passphrase = session.peekPassphrase();
  return passphrase ? vaultAccountAddresses(wallet, passphrase) : Promise.resolve([]);
};

/**
 * Builds passive extension-page status. Vault results are disclosed only to
 * the unlock that authorized the read; stale reads return locked status and
 * failures can revoke only their original session.
 */
export const statusResponse = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
): Promise<WalletStatus> => {
  const status = await wallet.status();
  const preferences = await preferencesStore.read();
  const network = STARKNET_NETWORKS[preferences.activeNetworkId];
  const lockedStatus: WalletStatus = {
    ...status,
    accountCount: 0,
    activeAccountId: null,
    accounts: [],
    // A wallet reader can be unavailable before it knows whether a vault
    // exists. Preserve its fail-closed status instead of treating no vault as
    // an unlocked first-run wallet.
    locked: status.locked,
    network: network.name,
    networkId: network.id,
    networks: networkOptions(),
  };
  // Peek, never renew: the side panel polls status, and a passive poll must
  // not hold the wallet unlocked past the inactivity limit.
  const passphrase = session.peekPassphrase();
  const authorized = captureSessionAuthorization(session);
  if (!passphrase) {
    return lockedStatus;
  }

  try {
    const vault = await wallet.readVault(passphrase);
    if (!authorized.isCurrent()) {
      return lockedStatus;
    }
    const activeAccount = accountForNetwork(
      vault,
      network.id,
      vault.activeAccountId,
      preferences.hiddenAccountIds,
    );
    return {
      ...status,
      accountCount: vault.accounts.length,
      activeAccountId: activeAccount?.id ?? null,
      accounts: vault.accounts,
      locked: false,
      network: network.name,
      networkId: network.id,
      networks: networkOptions(),
    };
  } catch {
    if (session.generation() === authorized.generation) {
      session.lock();
    }
    return lockedStatus;
  }
};
