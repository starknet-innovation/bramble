/** Typed extension message handling for the background service worker. */
import { activeAccountSecrets } from "@mc-wallet/vault/service";
import { DEFAULT_NETWORK } from "@mc-wallet/wallet-model/networks";
import { readCreateAccountInput } from "../accounts/account-creation-inputs";
import { readImportAccountInput } from "../accounts/import-inputs";
import { handleWalletOps, type WalletOpsDeps } from "../accounts/wallet-ops";
import type { WalletStatusReader } from "../accounts/wallet-reader";
import { handleApprovalDecision } from "../approvals/approval-decisions";
import { handleMobilePqOps } from "../devices/mobile-pq-ops";
import { handleLedgerOps } from "../ledger/ledger-ops";
import { handleMultisigCoordinationOps } from "../multisig/multisig-coordination-ops";
import { handleMultisigOps, type MultisigOpsDeps } from "../multisig/multisig-ops";
import { handleMultisigTxOps } from "../multisig/multisig-tx-ops";
import { handleOnboardingOps } from "../onboarding/onboarding-ops";
import { handleAllowanceOps } from "../portfolio/allowance-ops";
import { handleDiscoveryOps } from "../portfolio/discovery-ops";
import { handleNftOps } from "../portfolio/nft-ops";
import { handleTokenOps } from "../portfolio/token-ops";
import { handleStrk20Ops } from "../privacy/strk20-ops";
import { handleStrk20WalletOps } from "../privacy/strk20-wallet-ops";
import { handleAddChainOps } from "../provider/add-chain-ops";
import { handleProviderOps } from "../provider/provider-ops";
import {
  runUnlockedNetworkMutation,
  runVaultCreationWithNetwork,
} from "../runtime/active-network-mutation";
import {
  reconcileActiveAccount,
  reconcileUnlockedActiveAccount,
  selectActiveAccount,
  statusResponse,
  switchActiveNetwork,
} from "../runtime/runtime-state";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { createUnlockSession } from "../runtime/session";
import { handleOriginOps } from "../settings/origins-ops";
import { handlePreferenceOps } from "../settings/preference-ops";
import { supportDiagnosticsResponse } from "../support/diagnostics";
import { handleChainOps } from "../transactions/chain-ops";
import { handleDeclareOps } from "../transactions/declare-ops";
import { handleSwapOps } from "../transactions/swap-ops";
import {
  type MessageHandlerOptions,
  type RouterContext,
  type RouterHandler,
  routerContext,
} from "./message-context";
import {
  readAddAccountInput,
  readRevealSecretsInput,
  readSetActiveAccountInput,
  readSetActiveNetworkInput,
  readTypeOnlyInput,
  readUnlockInput,
} from "./message-inputs";
import {
  handleGetGrantedAccounts,
  handlePendingApprovals,
  handleRequestAccounts,
} from "./messages-connect";
import { isExtensionPageSender, parseGatedMessage, type RuntimeSender } from "./senders";
import { unlockFailureError } from "./unlock-errors";

const buildOpsDeps = (ctx: RouterContext): WalletOpsDeps => ({
  activeStateCoordinator: ctx.activeStateCoordinator,
  activity: ctx.activity,
  allowanceStore: ctx.allowanceStore,
  balanceSnapshots: ctx.balanceSnapshots,
  ledgerSignQueue: ctx.ledgerSignQueue,
  ...(ctx.mlDsa ? { mlDsa: ctx.mlDsa } : {}),
  mobilePqEnrollment: ctx.mobilePqEnrollment,
  mobilePqSignQueue: ctx.mobilePqSignQueue,
  multisigStore: ctx.multisigStore,
  ...(ctx.nftSnapshots ? { nftSnapshots: ctx.nftSnapshots } : {}),
  now: ctx.now,
  preferencesStore: ctx.preferencesStore,
  runtimeRpc: ctx.runtimeRpc,
  session: ctx.session,
  wallet: ctx.wallet,
});
const buildMultisigDeps = (ctx: RouterContext): MultisigOpsDeps => ({
  ...buildOpsDeps(ctx),
  multisigDeploymentReviews: ctx.multisigDeploymentReviews,
  multisigStore: ctx.multisigStore,
  nostrCoordinationStore: ctx.nostrCoordinationStore,
  ...(ctx.nostrRelayTransport ? { nostrRelayTransport: ctx.nostrRelayTransport } : {}),
  now: ctx.now,
});

const MULTISIG_ACTIVE_STATE_MESSAGES = new Set([
  "wallet.addMultisig",
  "wallet.deployArgentMultisig",
  "wallet.importArgentMultisigIntent",
  "wallet.importArgentMultisigSignature",
  "wallet.prepareArgentMultisigIntent",
  "wallet.removeArgentMultisigIntent",
  "wallet.removeMultisig",
  "wallet.reviewArgentMultisigDeployment",
  "wallet.signArgentMultisigIntent",
  "wallet.submitArgentMultisigIntent",
]);

const handleMultisig: RouterHandler = async (ctx, messageType, message) => {
  const handle = async (): Promise<RuntimeResponse | null> => {
    const deps = buildMultisigDeps(ctx);
    return (
      (await handleMultisigOps(deps, messageType, message)) ??
      (await handleMultisigTxOps(deps, messageType, message)) ??
      handleMultisigCoordinationOps(deps, messageType, message)
    );
  };
  return MULTISIG_ACTIVE_STATE_MESSAGES.has(messageType)
    ? ctx.activeStateCoordinator.run(handle)
    : handle();
};

const handleCreateAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.createAccount") {
    return null;
  }
  const input = readCreateAccountInput(message);
  if (!input) {
    return { error: "invalid create account request" };
  }
  const networkId = input.networkId ?? DEFAULT_NETWORK.id;
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runVaultCreationWithNetwork(
      ctx.session,
      ctx.preferencesStore,
      networkId,
      () => ctx.wallet.createAccount(input),
    );
    ctx.session.unlock(input.vaultPassphrase);
    return { account, ok: true };
  });
};

const handleAddAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.addAccount") {
    return null;
  }
  const input = readAddAccountInput(message);
  if (!input) {
    return { error: "invalid add account request" };
  }
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runUnlockedNetworkMutation(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      (vaultPassphrase) =>
        ctx.wallet.addDerivedAccount({
          accountContractType: input.accountContractType,
          networkId: input.networkId,
          vaultPassphrase,
        }),
    );
    return account ? { account, ok: true } : { error: "wallet locked" };
  });
};

const handleImportAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.importAccount") {
    return null;
  }
  const input = readImportAccountInput(message);
  if (!input) {
    return { error: "invalid import account request" };
  }
  const importRawKeyAccount = ctx.wallet.importRawKeyAccount;
  if (!importRawKeyAccount) {
    return { error: "wallet unavailable" };
  }
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runUnlockedNetworkMutation(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      (vaultPassphrase) => importRawKeyAccount({ ...input, vaultPassphrase }),
    );
    return account ? { account, ok: true } : { error: "wallet locked" };
  });
};

const handleGenerateMnemonic: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.generateMnemonic") {
    return null;
  }
  return readTypeOnlyInput(message, "wallet.generateMnemonic")
    ? { mnemonic: await ctx.wallet.generateMnemonic(), ok: true }
    : { error: "invalid generate mnemonic request" };
};

const handleRevealSecrets: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.revealSecrets") {
    return null;
  }
  const input = readRevealSecretsInput(message);
  if (!input) {
    return { error: "invalid reveal request" };
  }
  const { mnemonic, privateKey } = activeAccountSecrets(
    await ctx.wallet.readVault(input.vaultPassphrase),
  );
  return { mnemonic, ok: true, privateKey };
};

const handleSetActiveAccount: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.setActiveAccount") {
    return null;
  }
  const input = readSetActiveAccountInput(message);
  if (!input) {
    return { error: "invalid active account request" };
  }
  const account = await selectActiveAccount(
    ctx.wallet,
    ctx.session,
    ctx.preferencesStore,
    input.accountId,
    ctx.activeStateCoordinator,
  );
  return account ? { account, ok: true } : { error: "wallet locked" };
};

const handleSetActiveNetwork: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.setActiveNetwork") {
    return null;
  }
  const input = readSetActiveNetworkInput(message);
  if (!input) {
    return { error: "invalid network request" };
  }
  await switchActiveNetwork(
    ctx.wallet,
    ctx.session,
    ctx.preferencesStore,
    input.networkId,
    ctx.activeStateCoordinator,
  );
  return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
};

const handleStatus: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.status") {
    return null;
  }
  if (!readTypeOnlyInput(message, "wallet.status")) {
    return { error: "invalid status request" };
  }
  return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
};

const handleDiagnostics: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.diagnostics") return null;
  return readTypeOnlyInput(message, "wallet.diagnostics")
    ? supportDiagnosticsResponse(ctx.wallet, ctx.session, ctx.preferencesStore)
    : { error: "invalid diagnostics request" };
};

const handleUnlock: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.unlock") {
    return null;
  }
  const input = readUnlockInput(message);
  if (!input) {
    return { error: "invalid unlock request" };
  }
  const generation = ctx.session.generation();
  try {
    return await ctx.activeStateCoordinator.run(async () => {
      if (ctx.session.generation() !== generation) {
        return { error: "wallet locked" };
      }
      await ctx.wallet.readVault(input.vaultPassphrase);
      if (ctx.session.generation() !== generation) {
        return { error: "wallet locked" };
      }
      await reconcileActiveAccount(ctx.wallet, ctx.preferencesStore, input.vaultPassphrase);
      if (ctx.session.generation() !== generation) {
        return { error: "wallet locked" };
      }
      ctx.session.unlock(input.vaultPassphrase);
      return statusResponse(ctx.wallet, ctx.session, ctx.preferencesStore);
    });
  } catch (error) {
    throw unlockFailureError(error);
  }
};

const handlePreferences: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.importPreferences") {
    const response = await handlePreferenceOps(ctx.preferencesStore, messageType, message);
    if (messageType === "wallet.setNftIndexerUrl" && response && "preferences" in response) {
      await ctx.nftSnapshots?.clearAll().catch(() => undefined);
    }
    return response;
  }
  return ctx.activeStateCoordinator.run(async () => {
    const response = await handlePreferenceOps(ctx.preferencesStore, messageType, message);
    if (response && "preferences" in response) {
      await ctx.nftSnapshots?.clearAll().catch(() => undefined);
      await reconcileUnlockedActiveAccount(ctx.wallet, ctx.session, ctx.preferencesStore);
    }
    return response;
  });
};

// Ordered handlers own disjoint message types and return null otherwise.
//
// Deliberately absent (MCW-V09-124): there is no `wallet.signHash` message. An
// arbitrary field element signed with the account key, under no approval and no
// domain separation, is a signing oracle; hash signing is reachable only from
// inside the background through ./account-hash-signer.ts, which binds each hash
// to a reviewed operation. `wallet.grantOrigin` is absent for the same reason —
// origin grants are issued by ./approval-decisions.ts after a user decision, so
// no message may mint one directly. Do not re-add either as a message type.
const HANDLERS: readonly RouterHandler[] = [
  (ctx, messageType, message) => handleWalletOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleLedgerOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleMobilePqOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) =>
    handleSwapOps(
      {
        ...buildOpsDeps(ctx),
        swap: ctx.swap,
        swapPreparations: ctx.swapPreparations,
      },
      messageType,
      message,
    ),
  (ctx, messageType, message) => handleAllowanceOps(buildOpsDeps(ctx), messageType, message),
  (ctx, messageType, message) => handleNftOps(buildOpsDeps(ctx), messageType, message),
  handleMultisig,
  handlePreferences,
  (ctx, messageType, message, sender) => handleChainOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleProviderOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleDiscoveryOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleAddChainOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleDeclareOps(ctx, messageType, message, sender),
  (ctx, messageType, message, sender) => handleStrk20Ops(ctx, messageType, message, sender),
  (ctx, messageType, message) =>
    handleStrk20WalletOps(
      {
        ...buildOpsDeps(ctx),
        strk20Preparations: ctx.strk20Preparations,
      },
      messageType,
      message,
    ),
  (ctx, messageType, message) => handleOriginOps(ctx, messageType, message),
  (ctx, messageType, message) => handleTokenOps(ctx, messageType, message),
  handleCreateAccount,
  handleAddAccount,
  handleImportAccount,
  (ctx, messageType, message) => handleApprovalDecision(ctx, messageType, message),
  handleGenerateMnemonic,
  (ctx, messageType, message) => handleOnboardingOps(ctx, messageType, message),
  handleRevealSecrets,
  handleGetGrantedAccounts,
  handleDiagnostics,
  handlePendingApprovals,
  handleRequestAccounts,
  handleSetActiveAccount,
  handleSetActiveNetwork,
  handleStatus,
  handleUnlock,
];

const firstNonNull = async (
  handlers: readonly RouterHandler[],
  ctx: RouterContext,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse | null> => {
  for (const handler of handlers) {
    const response = await handler(ctx, messageType, message, sender);
    if (response) {
      return response;
    }
  }
  return null;
};

const handleRuntimeMessage = async (
  ctx: RouterContext,
  message: unknown,
  sender: RuntimeSender | undefined,
): Promise<RuntimeResponse> => {
  const gated = parseGatedMessage(message, sender, ctx.extensionId);
  if ("error" in gated) {
    return gated;
  }
  const response = await firstNonNull(HANDLERS, ctx, gated.messageType, message, sender);
  return response ?? { error: "unsupported message" };
};

const runtimeErrorResponse = (
  error: unknown,
  revealError: boolean,
): { readonly error: string } => ({
  error: revealError && error instanceof Error ? error.message : "wallet request failed",
});

/** Creates the trusted background runtime message dispatcher. */
export const createMessageHandler = (
  wallet: WalletStatusReader,
  extensionId: string,
  options: MessageHandlerOptions = {},
) => {
  const session = options.session ?? createUnlockSession();
  const ctx = routerContext(wallet, extensionId, options, session);
  return async (message: unknown, sender?: RuntimeSender): Promise<RuntimeResponse> => {
    try {
      return await handleRuntimeMessage(ctx, message, sender);
    } catch (error) {
      return runtimeErrorResponse(error, isExtensionPageSender(sender, extensionId));
    }
  };
};
