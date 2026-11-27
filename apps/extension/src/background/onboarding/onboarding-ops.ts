/** Privileged read-only first-run account derivation and mnemonic checks. */

import { WalletError } from "@bramble/core/errors";
import {
  recoveryProbeTokens,
  type TokenConfig,
  type WalletPreferencesStore,
} from "@bramble/settings/preferences";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import {
  isRecoverableAccountRef,
  type RecoverableAccountRef,
} from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import {
  keepsRecoveryCandidate,
  RECOVERY_SCAN_LIMITS,
  RESERVED_AGENT_ACCOUNT_INDEX,
  type RecoveryAccountCandidate,
  recoveryScanShapes,
  recoveryScanTarget,
} from "@bramble/wallet-model/recovery";
import { readAccountActivity } from "../accounts/account-activity";
import {
  readDiscoverOwnAccountsInput,
  readDiscoverRecoveryAccountsInput,
  readFindOwnAccountByAddressInput,
  readFindRecoveryAccountByAddressInput,
  readPreviewAccountInput,
  readRecoverAccountsInput,
  readValidateMnemonicInput,
} from "../accounts/account-creation-inputs";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { strk20PoolAddress, strk20RegisteredElsewhere } from "../privacy/strk20-registration-owner";
import {
  refuseExistingVault,
  runVaultCreationWithNetwork,
} from "../runtime/active-network-mutation";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { type ActiveStateCoordinator, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";
import { findAccountByAddress, verifyAddressSelections } from "./address-import";
import type { RecoveryDiscoveryCache } from "./recovery-cache";

type OnboardingOpsDeps = {
  readonly activeStateCoordinator: ActiveStateCoordinator;
  readonly preferencesStore: WalletPreferencesStore;
  readonly recoveryDiscovery: RecoveryDiscoveryCache;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

// Advisory only: a deployed account another wallet registered with the privacy
// pool is listed with a note, never refused. Read for deployed candidates only,
// since an undeployed address cannot have registered.
const privacyPoolNote = async (
  deps: OnboardingOpsDeps,
  derivation: AccountDerivationInput & { readonly networkId: StarknetNetworkId },
  address: string,
  poolAddress: string | null,
  rpcUrls: readonly string[],
): Promise<{ readonly privacyPool?: "other-wallet" }> => {
  const previewOwn = deps.wallet.previewStrk20ViewingPublicKey;
  if (!previewOwn) return {};
  const elsewhere = await strk20RegisteredElsewhere({
    address,
    networkId: derivation.networkId,
    ownPublicKey: (pool) => previewOwn({ ...derivation, ...pool }),
    poolAddress,
    readRegistered: deps.runtimeRpc.getStrk20PublicKey,
    rpcUrls,
  });
  return elsewhere ? { privacyPool: "other-wallet" } : {};
};

const describeRecoveryAccount = async (
  deps: OnboardingOpsDeps,
  account: RecoverableAccountRef,
  tokens: readonly TokenConfig[],
  rpcUrls: readonly string[],
  privacyPool: () => Promise<{ readonly privacyPool?: "other-wallet" }>,
): Promise<RecoveryAccountCandidate> => {
  const activity = await readAccountActivity(deps.runtimeRpc, {
    accountAddress: account.address,
    rpcUrls,
    tokens,
  });
  if (activity.deployed) {
    // Advisory signability verdict (issue 542): a deployed vendor account can
    // carry a guardian or strong signer, a rotated owner, or an unauthorizable
    // live class. A missing probe or a throw lists the row unlabelled — the
    // transaction path re-checks authoritatively, so this can mislabel but
    // never move funds.
    const probe =
      account.accountContractType === "argent"
        ? deps.runtimeRpc.getArgentSigningRestriction
        : account.accountContractType === "braavos"
          ? deps.runtimeRpc.getBraavosSigningRestriction
          : undefined;
    const restriction = await probe?.({
      accountAddress: account.address,
      publicKeyX: account.publicKeyX,
      rpcUrls,
    }).catch(() => null);
    return {
      account,
      deployed: true,
      funded: false,
      ...(restriction ? { restriction } : {}),
      ...(await privacyPool()),
    };
  }
  return { account, deployed: false, funded: activity.funded };
};

const discoveryFingerprint = (
  deps: OnboardingOpsDeps,
  input: { readonly mnemonic: string; readonly networkId: StarknetNetworkId },
) =>
  deps.wallet.previewAccount?.({
    accountContractType: "openzeppelin",
    accountIndex: 0,
    mnemonic: input.mnemonic,
    networkId: input.networkId,
  });

const scanRecoveryIndex = async (
  deps: OnboardingOpsDeps,
  input: { readonly mnemonic: string; readonly networkId: StarknetNetworkId },
  accountIndex: number,
  tokens: readonly TokenConfig[],
  rpcUrls: readonly string[],
  poolAddress: string | null,
): Promise<readonly RecoveryAccountCandidate[]> =>
  Promise.all(
    recoveryScanShapes().map(async (shape) => {
      const derivation = {
        accountContractType: shape.accountContractType,
        accountIndex,
        ...(shape.classHash === undefined ? {} : { classHash: shape.classHash }),
        ...(shape.derivation === undefined ? {} : { derivation: shape.derivation }),
        mnemonic: input.mnemonic,
        networkId: input.networkId,
      };
      const account = await deps.wallet.previewAccount?.(derivation);
      if (!isRecoverableAccountRef(account)) {
        throw new WalletError("Account discovery is unavailable");
      }
      return describeRecoveryAccount(deps, account, tokens, rpcUrls, () =>
        privacyPoolNote(deps, derivation, account.address, poolAddress, rpcUrls),
      );
    }),
  );

type DiscoverySnapshot = NonNullable<Awaited<ReturnType<RecoveryDiscoveryCache["read"]>>>;

// The progress a scan continues from. A stored scan for the same phrase and
// network is resumed while it is still short of its horizon. Once it has
// finished, the next page request starts a fresh walk from index 0 (Sherlock
// 218): Retry, or reopening the picker, must read the chain again rather than
// replay a stored "Search complete". The candidates found so far are kept, so
// picks survive and fresh reads replace them by id. A manual-index search
// never moves the walk's own progress.
const discoverySnapshot = (
  previous: DiscoverySnapshot | null,
  fingerprint: string,
  networkId: StarknetNetworkId,
  manualIndex: number | undefined,
): DiscoverySnapshot => {
  if (previous?.fingerprint !== fingerprint || previous.networkId !== networkId) {
    return { candidates: [], fingerprint, networkId, nextIndex: 0 };
  }
  const finished = previous.nextIndex >= recoveryScanTarget(previous.candidates);
  return manualIndex === undefined && finished ? { ...previous, nextIndex: 0 } : previous;
};

// One bounded read-only discovery walk shared by first-run recovery, the
// settings-surface import of a foreign phrase, and the rescan of the wallet's
// own phrase. It runs OUTSIDE the vault mutation queue: each index derives a
// preview and probes the chain, and holding the serialized write boundary across
// those round-trips would block every other vault mutation.
const runRecoveryDiscovery = async (
  deps: OnboardingOpsDeps,
  input: {
    readonly manualIndex?: number;
    readonly mnemonic: string;
    readonly networkId: StarknetNetworkId;
  },
  // Re-checked between indices when the phrase came from the unlocked vault: a
  // lock mid-scan stops the walk, so the phrase is not held across further
  // chain round-trips and nothing is cached under a session that has ended.
  stillAuthorized: () => boolean = () => true,
): Promise<RuntimeResponse> => {
  const fingerprintAccount = await discoveryFingerprint(deps, input);
  if (!fingerprintAccount) return { error: "account discovery is unavailable" };
  const previous = await deps.recoveryDiscovery.read().catch(() => null);
  const snapshot = discoverySnapshot(
    previous,
    fingerprintAccount.address,
    input.networkId,
    input.manualIndex,
  );
  const manual = input.manualIndex;
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences);
  const poolAddress = strk20PoolAddress(preferences, input.networkId);
  // Probe the recovery activity set, not just the display defaults: an
  // undeployed account funded only in native USDC has no ETH or STRK, so the
  // display-token probe would read it as empty and skip it (issue: USDC-only
  // accounts invisible to discovery).
  const tokens = recoveryProbeTokens().filter((token) => token.networkId === input.networkId);
  const start = manual ?? snapshot.nextIndex;
  // The scan horizon is a gap limit, not a fixed window: it always reaches
  // `defaultCount` indices past the last evidence of activity (issue 503), so
  // each batch is bounded by the target the candidates found so far justify.
  const end =
    manual ??
    Math.min(
      start + RECOVERY_SCAN_LIMITS.batchSize - 1,
      recoveryScanTarget(snapshot.candidates) - 1,
    );
  const discovered: RecoveryAccountCandidate[] = [];
  for (let accountIndex = start; accountIndex <= end; accountIndex += 1) {
    if (!stillAuthorized()) return { error: "wallet locked" };
    // strkd's agent branch (#336) is never derived. The walk is bounded by
    // `maxScannedIndexes` far below it and a manual index is refused at input,
    // so this only holds the line if either bound ever moves.
    if (accountIndex === RESERVED_AGENT_ACCOUNT_INDEX) continue;
    const candidates = await scanRecoveryIndex(
      deps,
      input,
      accountIndex,
      tokens,
      rpcUrls,
      poolAddress,
    );
    discovered.push(
      ...candidates.filter((candidate) =>
        keepsRecoveryCandidate(candidate, accountIndex, manual !== undefined),
      ),
    );
  }
  const byId = new Map(snapshot.candidates.map((candidate) => [candidate.account.id, candidate]));
  for (const candidate of discovered) byId.set(candidate.account.id, candidate);
  const nextIndex = manual === undefined ? end + 1 : snapshot.nextIndex;
  const next = { ...snapshot, candidates: [...byId.values()], nextIndex };
  if (!stillAuthorized()) return { error: "wallet locked" };
  await deps.recoveryDiscovery.write(next).catch(() => undefined);
  return {
    candidates: next.candidates,
    // Judged against what this batch found, so activity near the horizon's
    // edge reopens the scan — including activity a manual search turned up.
    complete: nextIndex >= recoveryScanTarget(next.candidates),
    nextIndex,
    ok: true,
  };
};

const discoverRecoveryAccounts = async (
  deps: OnboardingOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readDiscoverRecoveryAccountsInput(message);
  if (!input) return { error: "invalid recovery discovery request" };
  return runRecoveryDiscovery(deps, input);
};

// Rescans the wallet's OWN phrase from the settings surface. The phrase is read
// inside the vault boundary through the live unlock session and never returned
// to the panel; only public candidate metadata crosses back.
const discoverOwnAccounts = async (
  deps: OnboardingOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readDiscoverOwnAccountsInput(message);
  if (!input) return { error: "invalid account discovery request" };
  // getPassphrase renews the inactivity window: this scan is user-initiated.
  const vaultPassphrase = deps.session.getPassphrase();
  if (!vaultPassphrase) return { error: "wallet locked" };
  const authorized = captureSessionAuthorization(deps.session);
  // Keep only the phrase: the decrypted vault (signing keys included) is not
  // held across the scan's chain round-trips.
  const { mnemonic } = await deps.wallet.readVault(vaultPassphrase);
  if (mnemonic === null) {
    return { error: "This wallet has no recovery phrase to scan" };
  }
  return runRecoveryDiscovery(
    deps,
    {
      ...(input.manualIndex === undefined ? {} : { manualIndex: input.manualIndex }),
      mnemonic,
      networkId: input.networkId,
    },
    authorized.isCurrent,
  );
};

// Finds the account at a pasted address among the keys of the wallet's OWN
// phrase (issue 398). As in the own-phrase rescan, the phrase is read inside
// the vault boundary and only public candidate metadata crosses back.
const findOwnAccountByAddress = async (
  deps: OnboardingOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readFindOwnAccountByAddressInput(message);
  if (!input) return { error: "invalid account lookup request" };
  const vaultPassphrase = deps.session.getPassphrase();
  if (!vaultPassphrase) return { error: "wallet locked" };
  const authorized = captureSessionAuthorization(deps.session);
  const { mnemonic } = await deps.wallet.readVault(vaultPassphrase);
  if (mnemonic === null) {
    return { error: "This wallet has no recovery phrase to scan" };
  }
  return findAccountByAddress(deps, { ...input, mnemonic }, authorized.isCurrent);
};

// The two import-by-address lookups (issue 398), or null for any other message.
const handleAddressLookup = (
  deps: OnboardingOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse> | null => {
  if (messageType === "wallet.findOwnAccountByAddress") {
    return findOwnAccountByAddress(deps, message);
  }
  if (messageType !== "wallet.findRecoveryAccountByAddress") return null;
  const input = readFindRecoveryAccountByAddressInput(message);
  return input
    ? findAccountByAddress(deps, input)
    : Promise.resolve({ error: "invalid account lookup request" });
};

const recoverAccounts = async (
  deps: OnboardingOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readRecoverAccountsInput(message);
  const recover = deps.wallet.recoverAccounts;
  if (!input) return { error: "invalid recover accounts request" };
  if (!recover) return { error: "wallet unavailable" };
  // An account picked by its address is re-proved before anything is written.
  const refusal = await verifyAddressSelections(deps, input);
  if (refusal) return refusal;
  // The unlock lands inside the coordinator task, as every other vault-creation
  // path does: a queued task (a Ready-key import holding the old session's
  // authorization) must see the new generation the moment it runs, never a
  // replaced vault under the old one.
  const accounts = await deps.activeStateCoordinator.run(async () => {
    await refuseExistingVault(deps.session, deps.wallet, input.vaultPassphrase);
    const recovered = await runVaultCreationWithNetwork(
      deps.session,
      deps.preferencesStore,
      deps.wallet,
      input.networkId,
      () => recover(input),
    );
    deps.session.unlock(input.vaultPassphrase);
    return recovered;
  });
  return { accounts, ok: true };
};

/**
 * Handles read-only public account preview and Krusty mnemonic validation.
 * Returns null for unrelated messages and fails closed when the wallet surface
 * is unavailable; neither path persists or echoes secret material.
 */
export const handleOnboardingOps = async (
  deps: OnboardingOpsDeps,
  messageType: string,
  message: unknown,
): Promise<RuntimeResponse | null> => {
  const { wallet } = deps;
  if (messageType === "wallet.recoverAccounts") {
    return recoverAccounts(deps, message);
  }
  if (messageType === "wallet.discoverRecoveryAccounts") {
    return discoverRecoveryAccounts(deps, message);
  }
  if (messageType === "wallet.discoverOwnAccounts") {
    return discoverOwnAccounts(deps, message);
  }
  const addressLookup = handleAddressLookup(deps, messageType, message);
  if (addressLookup) return addressLookup;
  if (messageType === "wallet.previewAccount") {
    const input = readPreviewAccountInput(message);
    if (!input) {
      return { error: "invalid account preview request" };
    }
    if (!wallet.previewAccount) {
      return { error: "wallet unavailable" };
    }
    return { account: await wallet.previewAccount(input), ok: true };
  }
  if (messageType !== "wallet.validateMnemonic") {
    return null;
  }
  const input = readValidateMnemonicInput(message);
  if (!input) {
    return { error: "invalid mnemonic validation request" };
  }
  if (!wallet.validateMnemonic) {
    return { error: "wallet unavailable" };
  }
  return { ok: true, valid: await wallet.validateMnemonic(input.mnemonic) };
};
