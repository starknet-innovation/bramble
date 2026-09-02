/**
 * Privileged account-creation message handlers, split from messages.ts on the
 * size budget. All four paths carry secret material (mnemonic, raw private
 * key, or vault passphrase) inside extension-page-only messages; parsers
 * return null without echoing secrets, and every handler fails closed when
 * the wallet surface is unavailable.
 */
import { DEFAULT_NETWORK } from "@bramble/wallet-model/networks";
import { readCreateAccountInput } from "../accounts/account-creation-inputs";
import { readCreateKeyVaultInput, readImportAccountInput } from "../accounts/import-inputs";
import {
  runUnlockedNetworkMutation,
  runVaultCreationWithNetwork,
} from "../runtime/active-network-mutation";
import type { RuntimeResponse } from "../runtime/runtime-types";
import type { RouterContext } from "./message-context";
import { readAddAccountInput } from "./message-inputs";
import type { RuntimeSender } from "./senders";

/** One background message handler: null means "not mine", a response ends routing. */
export type RouterHandler = (
  ctx: RouterContext,
  messageType: string,
  message: unknown,
  sender: RuntimeSender | undefined,
) => Promise<RuntimeResponse | null>;

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

const handleCreateKeyVault: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.createKeyVault") {
    return null;
  }
  const input = readCreateKeyVaultInput(message);
  if (!input) {
    return { error: "invalid create key vault request" };
  }
  const createKeyVault = ctx.wallet.createKeyVault;
  if (!createKeyVault) {
    return { error: "wallet unavailable" };
  }
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runVaultCreationWithNetwork(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      () => createKeyVault(input),
    );
    ctx.session.unlock(input.vaultPassphrase);
    return { account, ok: true };
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

/**
 * Routes the four account-creation messages (create wallet, add derived
 * account, first-run key vault, raw-key import) to their handlers; null for
 * every other message type.
 */
export const handleAccountCreationOps: RouterHandler = async (ctx, messageType, message, sender) =>
  (await handleCreateAccount(ctx, messageType, message, sender)) ??
  (await handleAddAccount(ctx, messageType, message, sender)) ??
  (await handleCreateKeyVault(ctx, messageType, message, sender)) ??
  handleImportAccount(ctx, messageType, message, sender);
