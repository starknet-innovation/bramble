/**
 * Privileged account-creation message handlers, split from messages.ts on the
 * size budget. All four paths carry secret material (mnemonic, raw private
 * key, or vault passphrase) inside extension-page-only messages; parsers
 * return null without echoing secrets, and every handler fails closed when
 * the wallet surface is unavailable.
 */
import { RefusedBeforeWrite } from "@bramble/core/errors";
import { NO_RECOVERY_PHRASE_REFUSAL } from "@bramble/wallet-model/accounts";
import { DEFAULT_NETWORK, type StarknetNetworkId } from "@bramble/wallet-model/networks";
import {
  ADDRESS_IMPORT_REFUSALS,
  type RecoveryAccountSelection,
} from "@bramble/wallet-model/recovery";
import {
  readCreateAccountInput,
  readImportOwnAccountsInput,
  readImportSeedAccountsInput,
} from "../accounts/account-creation-inputs";
import { readCreateKeyVaultInput, readImportAccountInput } from "../accounts/import-inputs";
import { verifyReadyKeyClasses } from "../accounts/ready-key-accounts";
import { verifyAddressSelections } from "../onboarding/address-import";
import {
  runUnlockedNetworkMutation,
  runVaultCreationWithNetwork,
} from "../runtime/active-network-mutation";
import type { RuntimeResponse } from "../runtime/runtime-types";
import { captureSessionAuthorization, type SessionAuthorization } from "../runtime/session";
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
  // An account picked by its address is re-proved before the guarded write,
  // which locks the session on any error.
  const refusal = await verifyAddressSelections(ctx, input);
  if (refusal) return refusal;
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

// The phrase and unlock an own-phrase proof ran under. The write refuses
// unless both are still the ones it is about to use.
type OwnAddressProof = {
  readonly authorized: SessionAuthorization;
  readonly mnemonic: string;
};

// Re-proves the own-phrase picks made by address before the guarded write,
// reading the phrase through the live session as the import itself does, and
// returns what the proof was bound to (null when no pick carries an address).
const proveOwnAddressSelections = async (
  ctx: RouterContext,
  input: {
    readonly networkId: StarknetNetworkId;
    readonly selections: readonly RecoveryAccountSelection[];
  },
): Promise<{ readonly error: string } | { readonly proof: OwnAddressProof | null }> => {
  if (input.selections.every((selection) => selection.address === undefined)) {
    return { proof: null };
  }
  const passphrase = ctx.session.peekPassphrase();
  if (!passphrase) return { error: "wallet locked" };
  const authorized = captureSessionAuthorization(ctx.session);
  const { mnemonic } = await ctx.wallet.readVault(passphrase);
  if (mnemonic === null) return { error: "This wallet has no recovery phrase to scan" };
  const refusal = await verifyAddressSelections(ctx, { ...input, mnemonic });
  return refusal ?? { proof: { authorized, mnemonic } };
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
  const proved = await proveOwnAddressSelections(ctx, input);
  if ("error" in proved) return proved;
  const { proof } = proved;
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
        // An address proved under another unlock or phrase is not proved for
        // this one: a refusal before the write restores the network, no lock.
        if (proof && (!proof.authorized.isCurrent() || proof.mnemonic !== foundingPhrase)) {
          throw new RefusedBeforeWrite(ADDRESS_IMPORT_REFUSALS.stale);
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
  // serialized state boundary. The unlock that authorized the import must
  // still be the current one when it writes: a lock, a re-unlock or a replaced
  // vault during the reads refuses before the network preference or the vault
  // is touched, and never locks the session.
  const authorization = captureSessionAuthorization(ctx.session);
  if (!authorization.isCurrent()) {
    return { error: "wallet locked" };
  }
  const classHashes = await pickedReadyReleases(ctx, input);
  return ctx.activeStateCoordinator.run(async () => {
    if (!authorization.isCurrent()) {
      return { error: "wallet locked" };
    }
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
