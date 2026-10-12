/** Fail-closed coordination for preference-first encrypted-vault mutations. */
import { RefusedBeforeWrite, WalletError } from "@bramble/core/errors";
import type { WalletPreferencesStore } from "@bramble/settings/preferences";
import type { StarknetNetworkId } from "@bramble/wallet-model/networks";
import { heldSessionAuthorization, type UnlockSession } from "./session";

/**
 * Commits a network preference and its matching vault mutation under one
 * session generation. Browser-storage failures are ambiguous, so any failure
 * locks that exact generation and forces reconciliation on the next unlock.
 * The exception is a refusal the vault raises before writing anything, such as
 * a full vault (Sherlock 261) or an account that already exists: the session
 * stays unlocked and the earlier
 * network write is undone, so a routine add that cannot fit neither signs the
 * user out nor switches their network. Undoing it fails closed like any other
 * storage failure.
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
  // The caller's (generation, passphrase) pair IS the authorization token: a
  // helper that was handed a stale one must not begin the first durable write.
  const authorized = heldSessionAuthorization(session, generation, passphrase);
  const requireAuthorized = (): void => {
    if (!authorized.isCurrent()) {
      throw new WalletError(changedError);
    }
  };
  // A stale caller must not begin the first durable write. Callers also run
  // through the active-state coordinator in production, but this boundary
  // independently enforces the session token it receives.
  requireAuthorized();
  let previousNetworkId: StarknetNetworkId | null = null;
  try {
    previousNetworkId = (await preferencesStore.read()).activeNetworkId;
    await preferencesStore.setActiveNetwork(networkId);
    requireAuthorized();
    const result = await operation(passphrase);
    requireAuthorized();
    return result;
  } catch (error) {
    if (session.generation() === generation) {
      if (error instanceof RefusedBeforeWrite && previousNetworkId !== null) {
        await restoreNetwork(preferencesStore, previousNetworkId, networkId, session);
      } else {
        session.lock();
      }
    }
    throw error;
  }
};

// Undoes the network write of a mutation the vault refused before writing.
const restoreNetwork = async (
  preferencesStore: WalletPreferencesStore,
  previousNetworkId: StarknetNetworkId,
  networkId: StarknetNetworkId,
  session: UnlockSession,
): Promise<void> => {
  if (previousNetworkId === networkId) return;
  try {
    await preferencesStore.setActiveNetwork(previousNetworkId);
  } catch {
    session.lock();
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
