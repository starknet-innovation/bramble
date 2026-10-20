/** Privileged read-only first-run account derivation and mnemonic checks. */

import { WalletError } from "@bramble/core/errors";
import {
  recoveryProbeTokens,
  type TokenConfig,
  type WalletPreferencesStore,
} from "@bramble/settings/preferences";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_DEPLOYMENT_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { AccountContractType } from "@bramble/wallet-model/accounts";
import {
  isRecoverableAccountRef,
  type RecoverableAccountRef,
} from "@bramble/wallet-model/accounts";
import {
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import {
  RECOVERY_SCAN_LIMITS,
  RESERVED_AGENT_ACCOUNT_INDEX,
  type RecoveryAccountCandidate,
  type RecoveryDerivationKind,
  recoveryScanTarget,
} from "@bramble/wallet-model/recovery";
import {
  readDiscoverOwnAccountsInput,
  readDiscoverRecoveryAccountsInput,
  readPreviewAccountInput,
  readRecoverAccountsInput,
  readValidateMnemonicInput,
} from "../accounts/account-creation-inputs";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { runVaultCreationWithNetwork } from "../runtime/active-network-mutation";
import type { RuntimeRpc } from "../runtime/runtime-rpc";
import { type ActiveStateCoordinator, networkRpcUrls } from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type UnlockSession } from "../runtime/session";
import type { RecoveryDiscoveryCache } from "./recovery-cache";

type OnboardingOpsDeps = {
  readonly activeStateCoordinator: ActiveStateCoordinator;
  readonly preferencesStore: WalletPreferencesStore;
  readonly recoveryDiscovery: RecoveryDiscoveryCache;
  readonly runtimeRpc: RuntimeRpc;
  readonly session: UnlockSession;
  readonly wallet: WalletStatusReader;
};

const describeRecoveryAccount = async (
  deps: OnboardingOpsDeps,
  account: RecoverableAccountRef,
  tokens: readonly TokenConfig[],
  rpcUrls: readonly string[],
): Promise<RecoveryAccountCandidate> => {
  const deployed = await deps.runtimeRpc.getDeploymentStatus({
    accountAddress: account.address,
    rpcUrls,
  });
  if (deployed) {
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
    };
  }
  const balances = await deps.runtimeRpc.getTokenBalances({
    accountAddress: account.address,
    rpcUrls,
    tokens,
  });
  return {
    account,
    deployed: false,
    funded: balances.some((balance) => BigInt(balance.balance) > 0n),
  };
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

// One derivation per class an account could have been deployed with, not one
// per family. A Ready account deployed at Argent 0.3.x keeps that address
// forever, whatever it upgraded to, so scanning only the release this wallet
// creates finds nobody who arrived from Ready. The wallet's own OpenZeppelin
// class stays resolved per network by Krusty rather than listed here.
//
// Argent walks two ladders (issue 505): Ready derives its keys on an
// ETH-seeded tree ("argentx-bip44"), so every Argent release is scanned
// there, and the release this wallet creates is scanned once more on the
// wallet's own ladder for accounts this wallet made. Braavos keys live on the
// plain BIP-44 address axis, which the vault derivation maps to by family.
const recoveryScanShapes = (): readonly {
  readonly accountContractType: AccountContractType;
  readonly classHash?: string;
  readonly derivation?: RecoveryDerivationKind;
}[] => [
  { accountContractType: "openzeppelin" },
  { accountContractType: "argent", classHash: ARGENT_ACCOUNT_CLASS_HASH },
  ...deploymentClasses("argent").map((entry) => ({
    accountContractType: "argent" as const,
    classHash: entry.classHash,
    derivation: "argentx-bip44" as const,
  })),
  ...deploymentClasses("braavos").map((entry) => ({
    accountContractType: "braavos" as const,
    classHash: entry.classHash,
  })),
];

// Whether this candidate is listed before it exists on chain: one row per
// family at the class it creates today (its own OpenZeppelin account, Argent at
// the release it deploys, Braavos at the current app's deployment class), so
// every group shows its index-zero address. Only OpenZeppelin is selectable
// unused; the picker shows the other two view-only, since an undeployed,
// unfunded Ready or Braavos address belongs to nobody. Older releases and
// classes are only ever found.
const isCreatableCandidate = (account: RecoverableAccountRef): boolean =>
  account.derivation.kind === "starknet-bip44" &&
  (account.accountContractType === "openzeppelin" ||
    (account.accountContractType === "argent" &&
      sameFelt(account.classHash, ARGENT_ACCOUNT_CLASS_HASH)) ||
    (account.accountContractType === "braavos" &&
      sameFelt(account.classHash, BRAAVOS_DEPLOYMENT_CLASS_HASH)));

const scanRecoveryIndex = async (
  deps: OnboardingOpsDeps,
  input: { readonly mnemonic: string; readonly networkId: StarknetNetworkId },
  accountIndex: number,
  tokens: readonly TokenConfig[],
  rpcUrls: readonly string[],
): Promise<readonly RecoveryAccountCandidate[]> =>
  Promise.all(
    recoveryScanShapes().map(async (shape) => {
      const account = await deps.wallet.previewAccount?.({
        accountContractType: shape.accountContractType,
        accountIndex,
        ...(shape.classHash === undefined ? {} : { classHash: shape.classHash }),
        ...(shape.derivation === undefined ? {} : { derivation: shape.derivation }),
        mnemonic: input.mnemonic,
        networkId: input.networkId,
      });
      if (!isRecoverableAccountRef(account)) {
        throw new WalletError("Account discovery is unavailable");
      }
      return describeRecoveryAccount(deps, account, tokens, rpcUrls);
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
    const candidates = await scanRecoveryIndex(deps, input, accountIndex, tokens, rpcUrls);
    discovered.push(
      ...candidates.filter(
        (candidate) =>
          candidate.deployed ||
          candidate.funded ||
          (isCreatableCandidate(candidate.account) && (accountIndex === 0 || manual !== undefined)),
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

const recoverAccounts = async (
  deps: OnboardingOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readRecoverAccountsInput(message);
  const recover = deps.wallet.recoverAccounts;
  if (!input) return { error: "invalid recover accounts request" };
  if (!recover) return { error: "wallet unavailable" };
  const accounts = await deps.activeStateCoordinator.run(() =>
    runVaultCreationWithNetwork(deps.session, deps.preferencesStore, input.networkId, () =>
      recover(input),
    ),
  );
  deps.session.unlock(input.vaultPassphrase);
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
