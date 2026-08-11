/** Fail-closed coordination for preference-first encrypted-vault mutations. */
import { WalletError } from "@mc-wallet/core/errors";
import type { StarknetNetworkId } from "@mc-wallet/wallet-model/networks";
import type { WalletPreferencesStore } from "@mc-wallet/settings/preferences";
import type { UnlockSession } from "./session";

/**
 * Commits a network preference and its matching vault mutation under one
 * session generation. Browser-storage failures are ambiguous, so any failure
 * locks that exact generation and forces reconciliation on the next unlock.
 */
export const runGuardedNetworkMutation = async <T>(
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  networkId: StarknetNetworkId,
  passphrase: string,
  generation: number,
  changedError: string,
  operation: (vaultPassphrase: string) => Promise<T>,
): Promise<T> => {
  const authorized = (): boolean =>
    session.generation() === generation && session.peekPassphrase() === passphrase;
  const requireAuthorized = (): void => {
    if (!authorized()) {
      throw new WalletError(changedError);
    }
  };
  // A stale caller must not begin the first durable write. Callers also run
  // through the active-state coordinator in production, but this boundary
  // independently enforces the session token it receives.
  requireAuthorized();
  try {
    await preferencesStore.setActiveNetwork(networkId);
    requireAuthorized();
    const result = await operation(passphrase);
    requireAuthorized();
    return result;
  } catch (error) {
    if (session.generation() === generation) {
      session.lock();
    }
    throw error;
  }
};

/**
 * Runs a preference-first vault mutation under one unlocked session. The
 * caller must serialize this operation through the active-state coordinator.
 */
export const runUnlockedNetworkMutation = async <T>(
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  networkId: StarknetNetworkId,
  operation: (vaultPassphrase: string) => Promise<T>,
): Promise<T | null> => {
  const passphrase = session.getPassphrase();
  if (!passphrase) {
    return null;
  }
  return runGuardedNetworkMutation(
    session,
    preferencesStore,
    networkId,
    passphrase,
    session.generation(),
    "Unlock session changed during account mutation",
    operation,
  );
};

/**
 * Binds first-run vault creation to its network preference. If an old wallet
 * session exists, an ambiguous failure revokes only that generation.
 */
export const runVaultCreationWithNetwork = async <T>(
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  networkId: StarknetNetworkId,
  operation: () => Promise<T>,
): Promise<T> => {
  const existingPassphrase = session.peekPassphrase();
  if (!existingPassphrase) {
    await preferencesStore.setActiveNetwork(networkId);
    return operation();
  }
  return runGuardedNetworkMutation(
    session,
    preferencesStore,
    networkId,
    existingPassphrase,
    session.generation(),
    "Unlock session changed during vault creation",
    async () => operation(),
  );
};
