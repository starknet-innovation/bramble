/**
 * Privileged account-creation message handlers, split from messages.ts on the
 * size budget. All four paths carry secret material (mnemonic, raw private
 * key, or vault passphrase) inside extension-page-only messages; parsers
 * return null without echoing secrets, and every handler fails closed when
 * the wallet surface is unavailable.
 */
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { NO_RECOVERY_PHRASE_REFUSAL } from "@bramble/wallet-model/accounts";
import { DEFAULT_NETWORK } from "@bramble/wallet-model/networks";
import {
  readCreateAccountInput,
  readImportOwnAccountsInput,
  readImportSeedAccountsInput,
} from "../accounts/account-creation-inputs";
import { readCreateKeyVaultInput, readImportAccountInput } from "../accounts/import-inputs";
import { verifyReadyKeyClasses } from "../accounts/ready-key-accounts";
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

const missingPhraseRefusal = async (ctx: RouterContext): Promise<RuntimeResponse | null> => {
  const passphrase = ctx.session.peekPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const vault = await ctx.wallet.readVault(passphrase);
  return vault.mnemonic ? null : { error: NO_RECOVERY_PHRASE_REFUSAL };
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
    // A vault set up from a private key or a Ledger has no phrase to derive
    // from, and that refusal is certain. Answer it before the guarded mutation,
    // which persists the requested network first and locks the session on any
    // error: a routine menu choice must neither sign the user out nor switch
    // their network (Sherlock 156).
    const refusal = await missingPhraseRefusal(ctx);
    if (refusal) {
      return refusal;
    }
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

// A "Ready Account" key import names the releases the user picked; each is
// re-proved on chain before the write, so the class is never the message's
// word alone. Other families import at their default and name none.
const pickedReadyReleases = async (
  ctx: RouterContext,
  input: NonNullable<ReturnType<typeof readImportAccountInput>>,
): Promise<{ readonly classHashes?: readonly string[] }> => {
  if (input.accountContractType !== "argent") return {};
  const { classHashes = [], deploymentSalt, networkId, privateKey } = input;
  return {
    classHashes: await verifyReadyKeyClasses(
      ctx,
      { ...(deploymentSalt === undefined ? {} : { deploymentSalt }), networkId, privateKey },
      classHashes,
    ),
  };
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
  const classHashes = await pickedReadyReleases(ctx, input);
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runVaultCreationWithNetwork(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      () => createKeyVault({ ...input, ...classHashes }),
    );
    ctx.session.unlock(input.vaultPassphrase);
    return { account, ok: true };
  });
};

const handleImportSeedAccounts: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.importSeedAccounts") {
    return null;
  }
  const input = readImportSeedAccountsInput(message);
  if (!input) {
    return { error: "invalid import seed accounts request" };
  }
  const importSeedAccounts = ctx.wallet.importSeedAccounts;
  if (!importSeedAccounts) {
    return { error: "wallet unavailable" };
  }
  return ctx.activeStateCoordinator.run(async () => {
    const accounts = await runUnlockedNetworkMutation(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      (vaultPassphrase) => importSeedAccounts({ ...input, vaultPassphrase }),
    );
    return accounts ? { accounts, ok: true } : { error: "wallet locked" };
  });
};

const handleImportOwnAccounts: RouterHandler = async (ctx, messageType, message) => {
  if (messageType !== "wallet.importOwnAccounts") {
    return null;
  }
  const input = readImportOwnAccountsInput(message);
  if (!input) {
    return { error: "invalid import own accounts request" };
  }
  const importSeedAccounts = ctx.wallet.importSeedAccounts;
  if (!importSeedAccounts) {
    return { error: "wallet unavailable" };
  }
  return ctx.activeStateCoordinator.run(async () => {
    const accounts = await runUnlockedNetworkMutation(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      async (vaultPassphrase) => {
        // The wallet's own phrase is read inside the vault boundary; the
        // founding-phrase path of the seed import then derives the selections
        // with no imported-seed handle, so the own phrase is never retained.
        const vault = await ctx.wallet.readVault(vaultPassphrase);
        const foundingPhrase = vault.mnemonic;
        if (foundingPhrase === null) {
          throw new RefusedBeforeWrite("This wallet has no recovery phrase to scan");
        }
        return importSeedAccounts({
          mnemonic: foundingPhrase,
          networkId: input.networkId,
          selections: input.selections,
          vaultPassphrase,
        });
      },
    );
    return accounts ? { accounts, ok: true } : { error: "wallet locked" };
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
  // Probed outside the coordinator: the chain round-trips must not hold the
  // serialized state boundary.
  const classHashes = await pickedReadyReleases(ctx, input);
  return ctx.activeStateCoordinator.run(async () => {
    const account = await runUnlockedNetworkMutation(
      ctx.session,
      ctx.preferencesStore,
      input.networkId,
      (vaultPassphrase) => importRawKeyAccount({ ...input, ...classHashes, vaultPassphrase }),
    );
    return account ? { account, ok: true } : { error: "wallet locked" };
  });
};

/**
 * Routes the account-creation messages (create wallet, add derived account,
 * first-run key vault, foreign-phrase import, own-phrase import, raw-key
 * import) to their handlers; null for every other message type.
 */
export const handleAccountCreationOps: RouterHandler = async (ctx, messageType, message, sender) =>
  (await handleCreateAccount(ctx, messageType, message, sender)) ??
  (await handleAddAccount(ctx, messageType, message, sender)) ??
  (await handleCreateKeyVault(ctx, messageType, message, sender)) ??
  (await handleImportSeedAccounts(ctx, messageType, message, sender)) ??
  (await handleImportOwnAccounts(ctx, messageType, message, sender)) ??
  handleImportAccount(ctx, messageType, message, sender);
