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
        await restoreNetwork(preferencesStore, previousNetworkId, networkId, session, generation);
      } else {
        session.lock();
      }
    }
    throw error;
  }
};

// Undoes the network write of a mutation the vault refused before writing. A
// failed undo locks only the session the mutation ran under: the user may have
// locked and unlocked again while the write was in flight, and that newer
// session has nothing to do with this mutation.
const restoreNetwork = async (
  preferencesStore: WalletPreferencesStore,
  previousNetworkId: StarknetNetworkId,
  networkId: StarknetNetworkId,
  session: UnlockSession,
  generation: number,
): Promise<void> => {
  if (previousNetworkId === networkId) return;
  try {
    await preferencesStore.setActiveNetwork(previousNetworkId);
  } catch {
    if (session.generation() === generation) session.lock();
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

/** The one vault fact the creation guards read: whether any vault is stored. */
export type VaultPresence = {
  readonly status: () => Promise<{ readonly hasVault: boolean }>;
};

/**
 * Binds first-run vault creation to its network preference. If an old wallet
 * session exists, an ambiguous failure revokes only that generation. A refusal
 * the vault raises before writing, such as a wallet that already exists, undoes
 * the network write on either path. With no session, any failure that leaves
 * no vault stored also undoes it: nothing was written, so no account can be
 * left on the requested network (issue 822).
 */
export const runVaultCreationWithNetwork = async <T>(
  session: UnlockSession,
  preferencesStore: WalletPreferencesStore,
  wallet: VaultPresence,
  networkId: StarknetNetworkId,
  operation: () => Promise<T>,
): Promise<T> => {
  const existingPassphrase = session.peekPassphrase();
  if (!existingPassphrase) {
    const previousNetworkId = (await preferencesStore.read()).activeNetworkId;
    await preferencesStore.setActiveNetwork(networkId);
    try {
      return await operation();
    } catch (error) {
      // No session to lock here: a failed undo leaves the network switched and
      // the vault's own refusal is still what the caller hears.
      if (previousNetworkId !== networkId && (await nothingWritten(wallet, error))) {
        await preferencesStore.setActiveNetwork(previousNetworkId).catch(() => undefined);
      }
      throw error;
    }
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

// A failed first-run creation wrote nothing when the vault refused before its
// write, or when no vault is stored afterwards. A vault that is present may
// hold this request's write, and an unreadable status proves nothing, so
// either keeps the network the write was bound to.
const nothingWritten = async (wallet: VaultPresence, error: unknown): Promise<boolean> => {
  if (error instanceof RefusedBeforeWrite) return true;
  try {
    return !(await wallet.status()).hasVault;
  } catch {
    return false;
  }
};

/**
 * Refuses a creation that only ever writes a fresh store (a Ledger vault, a
 * recovered wallet) while a vault exists, before the network preference is
 * touched. The vault would refuse it too, but a wrong passphrase fails
 * decryption first, and that failure with a vault present cannot prove that
 * nothing was written, so the network write would stay (issue 822). The
 * session's own passphrase is let through: it opens the vault, whose refusal
 * then undoes the network and keeps the session.
 */
export const refuseExistingVault = async (
  session: UnlockSession,
  wallet: VaultPresence,
  vaultPassphrase: string,
): Promise<void> => {
  if (session.peekPassphrase() === vaultPassphrase) return;
  if ((await wallet.status()).hasVault) {
    throw new WalletError("Wallet already exists");
  }
};
