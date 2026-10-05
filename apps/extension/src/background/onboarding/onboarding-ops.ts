/** Privileged read-only first-run account derivation and mnemonic checks. */

import { WalletError } from "@bramble/core/errors";
import {
  defaultWalletPreferences,
  type TokenConfig,
  type WalletPreferencesStore,
} from "@bramble/settings/preferences";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { AccountContractType } from "@bramble/wallet-model/accounts";
import { type DerivedAccountRef, isDerivedAccountRef } from "@bramble/wallet-model/accounts";
import {
  STARKNET_NETWORKS,
  type StarknetNetworkId,
  sameFelt,
} from "@bramble/wallet-model/networks";
import {
  RECOVERY_SCAN_LIMITS,
  type RecoveryAccountCandidate,
  recoveryScanTarget,
} from "@bramble/wallet-model/recovery";
import {
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
import type { UnlockSession } from "../runtime/session";
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
  account: DerivedAccountRef,
  tokens: readonly TokenConfig[],
  rpcUrls: readonly string[],
): Promise<RecoveryAccountCandidate> => {
  const deployed = await deps.runtimeRpc.getDeploymentStatus({
    accountAddress: account.address,
    rpcUrls,
  });
  if (deployed) return { account, deployed: true, funded: false };
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
const recoveryScanShapes = (): readonly {
  readonly accountContractType: AccountContractType;
  readonly classHash?: string;
}[] => [
  { accountContractType: "openzeppelin" },
  ...(["argent", "braavos"] as const).flatMap((family) =>
    deploymentClasses(family).map((entry) => ({
      accountContractType: family,
      classHash: entry.classHash,
    })),
  ),
];

// Whether this wallet would itself create an account at this candidate's class:
// its own OpenZeppelin account, or Argent at the release it deploys. Only those
// are worth showing before they exist on chain — index zero is where a new
// wallet's first account lives. A Braavos account, or Argent at any other
// release, is only ever found; undeployed and unfunded, it is an address that
// belongs to nobody, and offering it would import an account that does not exist.
const isCreatableCandidate = (account: DerivedAccountRef): boolean =>
  account.accountContractType === "openzeppelin" ||
  (account.accountContractType === "argent" &&
    sameFelt(account.classHash, ARGENT_ACCOUNT_CLASS_HASH));

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
        mnemonic: input.mnemonic,
        networkId: input.networkId,
      });
      if (!isDerivedAccountRef(account)) {
        throw new WalletError("Account discovery is unavailable");
      }
      return describeRecoveryAccount(deps, account, tokens, rpcUrls);
    }),
  );

const discoverRecoveryAccounts = async (
  deps: OnboardingOpsDeps,
  message: unknown,
): Promise<RuntimeResponse> => {
  const input = readDiscoverRecoveryAccountsInput(message);
  if (!input) return { error: "invalid recovery discovery request" };
  const fingerprintAccount = await discoveryFingerprint(deps, input);
  if (!fingerprintAccount) return { error: "account discovery is unavailable" };
  const previous = await deps.recoveryDiscovery.read().catch(() => null);
  const matching =
    previous?.fingerprint === fingerprintAccount.address && previous.networkId === input.networkId;
  const snapshot = matching
    ? previous
    : {
        candidates: [],
        fingerprint: fingerprintAccount.address,
        networkId: input.networkId,
        nextIndex: 0,
      };
  const manual = input.manualIndex;
  const preferences = await deps.preferencesStore.read();
  const rpcUrls = networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences);
  const tokens = defaultWalletPreferences().tokens.filter(
    (token) => token.networkId === input.networkId,
  );
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
