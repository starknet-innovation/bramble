/**
 * Privileged account-creation message handlers, split from messages.ts on the
 * size budget. All four paths carry secret material (mnemonic, raw private
 * key, or vault passphrase) inside extension-page-only messages; parsers
 * return null without echoing secrets, and every handler fails closed when
 * the wallet surface is unavailable.
 */
import { RefusedBeforeWrite } from "@bramble/core/errors";
import type { AccountContractType } from "@bramble/wallet-model/accounts";
import {
  DEFAULT_NETWORK,
  STARKNET_NETWORKS,
  type StarknetNetworkId,
} from "@bramble/wallet-model/networks";
import {
  readCreateAccountInput,
  readImportOwnAccountsInput,
  readImportSeedAccountsInput,
} from "../accounts/account-creation-inputs";
import { readCreateKeyVaultInput, readImportAccountInput } from "../accounts/import-inputs";
import {
  STRK20_IMPORT_REFUSALS,
  strk20ImportBlock,
  strk20ImportPool,
} from "../privacy/strk20-import-guard";
import {
  runUnlockedNetworkMutation,
  runVaultCreationWithNetwork,
} from "../runtime/active-network-mutation";
import { networkRpcUrls } from "../runtime/runtime-state";
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

// The refusal `addDerivedAccount` raises for a vault with no phrase, verbatim.
const NO_RECOVERY_PHRASE = "No recovery phrase stored for this wallet";

const missingPhraseRefusal = async (ctx: RouterContext): Promise<RuntimeResponse | null> => {
  const passphrase = ctx.session.peekPassphrase();
  if (!passphrase) {
    return { error: "wallet locked" };
  }
  const vault = await ctx.wallet.readVault(passphrase);
  return vault.mnemonic ? null : { error: NO_RECOVERY_PHRASE };
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

// Refuses a raw key whose account another wallet registered with the privacy
// pool, before anything is stored (see strk20-import-guard). An invalid key
// throws here exactly as the import itself would.
const rawKeyPrivacyRefusal = async (
  ctx: RouterContext,
  input: {
    readonly accountContractType: AccountContractType;
    readonly deploymentSalt?: string;
    readonly networkId: StarknetNetworkId;
    readonly privateKey: string;
  },
): Promise<RuntimeResponse | null> => {
  const preferences = await ctx.preferencesStore.read();
  const pool = strk20ImportPool(preferences, input.networkId);
  if (!pool) return null;
  const preview = ctx.wallet.previewImportedStrk20ViewingPublicKey;
  if (!preview) return { error: STRK20_IMPORT_REFUSALS.unchecked };
  const own = await preview({
    accountContractType: input.accountContractType,
    ...(input.deploymentSalt === undefined ? {} : { deploymentSalt: input.deploymentSalt }),
    networkId: input.networkId,
    privateKey: input.privateKey,
    ...pool,
  });
  const block = await strk20ImportBlock({
    address: own.address,
    ownViewingPublicKey: async () => own.viewingPublicKey,
    pool,
    readRegistered: ctx.runtimeRpc.getStrk20PublicKey,
    rpcUrls: networkRpcUrls(STARKNET_NETWORKS[input.networkId], preferences),
  });
  return block ? { error: STRK20_IMPORT_REFUSALS[block] } : null;
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
  const refusal = await rawKeyPrivacyRefusal(ctx, input);
  if (refusal) return refusal;
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
  // A locked wallet answers as it always has, before any derivation or read.
  if (!ctx.session.peekPassphrase()) {
    return { error: "wallet locked" };
  }
  const refusal = await rawKeyPrivacyRefusal(ctx, input);
  if (refusal) return refusal;
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
