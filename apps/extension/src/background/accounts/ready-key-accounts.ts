/**
 * Which Argent releases a raw "Ready Account" key restores.
 *
 * One key maps to a different address under every Argent release, because the
 * class hash and the constructor calldata are both part of the address, and an
 * account keeps the address its deploy class fixed whatever it upgrades to.
 * Importing a Ready key at the release this wallet creates gave a user an empty
 * 0.4.0 address while their real account sat at its 0.3.1 address (issue 776).
 *
 * Nothing is chosen silently. Discovery lists every release whose address has
 * on-chain evidence, and the user picks; a funded-only address may be someone
 * else's dust, so it is offered but never preselected. The picked releases are
 * re-read before anything is written, so a class is never taken from the
 * message on trust. Derivation goes through the vault's key-free preview: the
 * key never leaves the background and no answer carries it.
 *
 * Trust model (owner decision, 2026-10-27, the same as #398): the evidence is
 * read from the configured RPC, which is SNF-operated by default. A malicious
 * custom RPC could call an empty address "deployed" and so pre-tick its row,
 * but every listed address is derived locally from this key, so the worst case
 * is an empty account the user controls, never someone else's address.
 */
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { recoveryProbeTokens, type WalletPreferencesStore } from "@bramble/settings/preferences";
import type { PreviewImportedAccountInput } from "@bramble/vault/service";
import { deploymentClasses } from "@bramble/wallet-model/account-families";
import { canonicalFelt, STARKNET_NETWORKS, sameFelt } from "@bramble/wallet-model/networks";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { networkRpcUrls } from "../runtime/runtime-state";
import { type AccountHolding, readAccountActivity } from "./account-activity";
import type { WalletStatusReader } from "./wallet-reader";

/** Raw diagnostic for a Ready key with no account behind it on this network. */
export const NO_READY_ACCOUNT_FOR_KEY = "No Ready account found for this key";

/** Raw diagnostic for a Ready-key check the chain could not answer. */
export const READY_KEY_CHECK_UNAVAILABLE = "Ready account check unavailable";

/**
 * One Argent release this key controls an address at, with the evidence that
 * the address is in use. Public data only: address, id and class.
 */
export type ReadyKeyCandidate =
  | {
      readonly accountId: string;
      readonly address: string;
      readonly classHash: string;
      readonly deployed: true;
    }
  | {
      readonly accountId: string;
      readonly address: string;
      readonly classHash: string;
      readonly deployed: false;
      readonly holdings: readonly AccountHolding[];
    };

type ReadyKeyDeps = {
  readonly preferencesStore: WalletPreferencesStore;
  readonly runtimeRpc: Pick<RuntimeRpc, "getDeploymentStatus" | "getTokenBalances">;
  readonly wallet: Pick<WalletStatusReader, "previewImportedAccount">;
};

/** The key, network and optional salt a Ready-key read derives from. */
export type ReadyKeyInput = Omit<PreviewImportedAccountInput, "accountContractType" | "classHash">;

// Reads one release's address and its evidence. Null when the address shows
// none. Any failure (no preview, an RPC error) refuses the whole read: a
// missing answer must never look like "no account here".
const readRelease = async (
  deps: ReadyKeyDeps,
  input: ReadyKeyInput,
  classHash: string,
  rpcUrls: readonly string[],
): Promise<ReadyKeyCandidate | null> => {
  const preview = deps.wallet.previewImportedAccount;
  if (!preview) throw new RefusedBeforeWrite(READY_KEY_CHECK_UNAVAILABLE);
  const account = await preview({ ...input, accountContractType: "argent", classHash });
  const tokens = recoveryProbeTokens().filter((token) => token.networkId === input.networkId);
  const activity = await readAccountActivity(deps.runtimeRpc, {
    accountAddress: account.address,
    rpcUrls,
    tokens,
  });
  const where = { accountId: account.id, address: account.address, classHash };
  if (activity.deployed) return { ...where, deployed: true };
  return activity.funded ? { ...where, deployed: false, holdings: activity.holdings } : null;
};

const readReleases = async (
  deps: ReadyKeyDeps,
  input: ReadyKeyInput,
  classHashes: readonly string[],
): Promise<readonly (ReadyKeyCandidate | null)[]> => {
  const rpcUrls = networkRpcUrls(
    STARKNET_NETWORKS[input.networkId],
    await deps.preferencesStore.read(),
  );
  try {
    return await Promise.all(
      classHashes.map((classHash) => readRelease(deps, input, classHash, rpcUrls)),
    );
  } catch {
    throw new RefusedBeforeWrite(READY_KEY_CHECK_UNAVAILABLE);
  }
};

/**
 * Lists every Argent release at which this key controls an address with
 * on-chain evidence, in the class table's order. Refuses when there is none,
 * and when the chain cannot be read: an unreadable network never yields an
 * empty list.
 */
export const discoverReadyKeyAccounts = async (
  deps: ReadyKeyDeps,
  input: ReadyKeyInput,
): Promise<readonly ReadyKeyCandidate[]> => {
  const releases = deploymentClasses("argent").map((entry) => entry.classHash);
  const found = (await readReleases(deps, input, releases)).filter(
    (candidate): candidate is ReadyKeyCandidate => candidate !== null,
  );
  if (found.length === 0) throw new RefusedBeforeWrite(NO_READY_ACCOUNT_FOR_KEY);
  return found;
};

/**
 * Re-proves the releases a user picked, just before the import writes them:
 * each must be an Argent deployment class, and its address must still show
 * on-chain evidence. Returns the canonical class hashes in the picked order.
 * Refuses otherwise, before anything is written.
 */
export const verifyReadyKeyClasses = async (
  deps: ReadyKeyDeps,
  input: ReadyKeyInput,
  picked: readonly string[],
): Promise<readonly string[]> => {
  if (picked.length === 0) throw new RefusedBeforeWrite(NO_READY_ACCOUNT_FOR_KEY);
  const table = deploymentClasses("argent");
  const classHashes = picked.map((classHash) => {
    const entry = table.find((candidate) => sameFelt(candidate.classHash, classHash));
    if (!entry) throw new RefusedBeforeWrite(NO_READY_ACCOUNT_FOR_KEY);
    return canonicalFelt(entry.classHash) ?? entry.classHash;
  });
  const releases = await readReleases(deps, input, classHashes);
  if (releases.some((release) => release === null)) {
    throw new RefusedBeforeWrite(NO_READY_ACCOUNT_FOR_KEY);
  }
  return classHashes;
};
