/**
 * Shared background status helpers for wallet runtime messages.
 */

import { WalletError } from "@mc-wallet/core/errors";
import {
  defaultWalletPreferences,
  type WalletPreferences,
  type WalletPreferencesStore,
} from "@mc-wallet/settings/preferences";
import { serializeStoreMutations } from "@mc-wallet/store/mutation";
import type { Vault } from "@mc-wallet/vault/schema";
import { findVaultAccount } from "@mc-wallet/vault/vault-account";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import {
  DEFAULT_NETWORK,
  STARKNET_NETWORKS,
  type StarknetNetwork,
  type StarknetNetworkId,
} from "@mc-wallet/wallet-model/networks";
import type { NetworkOption, WalletStatus } from "@mc-wallet/wallet-protocol/extension-responses";
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
 * Fallback preferences store used by tests that do not wire browser storage.
 */
export const unavailablePreferencesStore: WalletPreferencesStore = {
  async addCustomNetwork() {
    throw new Error("preferences unavailable");
  },
  async addNft() {
    throw new Error("preferences unavailable");
  },
  async createGroup() {
    throw new Error("preferences unavailable");
  },
  async importPreferences() {
    throw new Error("preferences unavailable");
  },
  async read() {
    return defaultWalletPreferences();
  },
  async removeAddress() {
    throw new Error("preferences unavailable");
  },
  async removeGroup() {
    throw new Error("preferences unavailable");
  },
  async removeNft() {
    throw new Error("preferences unavailable");
  },
  async renameGroup() {
    throw new Error("preferences unavailable");
  },
  async setAccountInGroup() {
    throw new Error("preferences unavailable");
  },
  async setExplorerFallback() {
    throw new Error("preferences unavailable");
  },
  async setGroupIcon() {
    throw new Error("preferences unavailable");
  },
  async setAccountLabel() {
    throw new Error("preferences unavailable");
  },
  async setDisplay() {
    throw new Error("preferences unavailable");
  },
  async setNftIndexerUrl() {
    throw new Error("preferences unavailable");
  },
  async setNostrRelayUrl() {
    throw new Error("preferences unavailable");
  },
  async setNftSpam() {
    throw new Error("preferences unavailable");
  },
  async saveAddress() {
    throw new Error("preferences unavailable");
  },
  async setActiveNetwork(networkId) {
    return { ...defaultWalletPreferences(), activeNetworkId: networkId };
  },
  async setRpcOverride() {
    throw new Error("preferences unavailable");
  },
  async setStrk20NetworkConfig() {
    throw new Error("preferences unavailable");
  },
  async setTokenHidden() {
    throw new Error("preferences unavailable");
  },
  async upsertToken() {
    throw new Error("preferences unavailable");
  },
};

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
 * Returns the active account for a network, falling back to the first account on that network.
 */
const accountForNetwork = (
  vault: Vault,
  networkId: StarknetNetworkId,
  accountId?: string | null,
): AccountRef | null =>
  vault.accounts.find((account) => account.id === accountId && account.networkId === networkId) ??
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
  const account = accountForNetwork(vault, preferences.activeNetworkId, vault.activeAccountId);
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
 */
export const selectActiveAccount = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  accountId: string,
  coordinator?: ActiveStateCoordinator,
): Promise<AccountRef | null> =>
  runActiveStateMutation(coordinator, async () => {
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
  });

const selectNetworkAccount = async (
  wallet: WalletStatusReader,
  networkId: StarknetNetworkId,
  passphrase: string,
  authorized: () => boolean,
): Promise<AccountRef | null> => {
  const vault = await wallet.readVault(passphrase);
  requireCurrentNetworkSwitch(authorized);
  const account = accountForNetwork(vault, networkId, vault.activeAccountId);
  if (account?.id === vault.activeAccountId) {
    return account;
  }
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
 */
export const switchActiveNetwork = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  networkId: StarknetNetworkId,
  coordinator?: ActiveStateCoordinator,
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
    return runGuardedNetworkMutation(
      session,
      preferencesStore,
      networkId,
      passphrase,
      generation,
      "Unlock session changed during network switch",
      (vaultPassphrase) => selectNetworkAccount(wallet, networkId, vaultPassphrase, authorized),
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
  const account = accountForNetwork(vault, preferences.activeNetworkId, vault.activeAccountId);
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

/**
 * Builds extension-page wallet status from vault and preferences state.
 */
export const statusResponse = async (
  wallet: WalletStatusReader,
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
): Promise<WalletStatus> => {
  const status = await wallet.status();
  const preferences = await preferencesStore.read();
  const network = STARKNET_NETWORKS[preferences.activeNetworkId];
  // Peek, never renew: the side panel polls status, and a passive poll must
  // not hold the wallet unlocked past the inactivity limit.
  const passphrase = session.peekPassphrase();
  if (!passphrase) {
    return {
      ...status,
      accounts: [],
      network: network.name,
      networkId: network.id,
      networks: networkOptions(),
    };
  }

  try {
    const vault = await wallet.readVault(passphrase);
    const activeAccount = accountForNetwork(vault, network.id, vault.activeAccountId);
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
    session.lock();
    return {
      ...status,
      accounts: [],
      network: DEFAULT_NETWORK.name,
      networkId: DEFAULT_NETWORK.id,
      networks: networkOptions(),
    };
  }
};
