/**
 * Shared harness for the private-key import-by-address suites (issue 779): a
 * wallet whose key-free preview answers one public key and captures what an
 * import or a first-run vault would write, a scriptable vault presence, and an
 * owner reader that answers per source so one endpoint can be made to lie.
 */
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { AccountOwnerReading } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import type {
  CreateKeyVaultInput,
  ImportRawKeyAccountInput,
  PreviewImportedAccountInput,
} from "@bramble/vault/service";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { argentOwner, type OwnerRead, PASTED } from "./address-import-harness";
import { account, createWallet, testExtension, vaultPassphrase } from "./background-wallet-stub";

export { argentOwner, type OwnerRead, PASTED };

// Clearly-fake test vectors; not a real key.
export const KEY = "0xfeedface";
/** The public key the stub preview derives from {@link KEY}. */
const KEY_PUBLIC = "0x5eed";

type OwnerAnswer =
  | AccountOwnerReading
  | Error
  | ((input: OwnerRead) => AccountOwnerReading | Error);

type KeyAddressOptions = {
  /** Whether a vault exists, re-read on every status call (first-run races). */
  readonly hasVault?: () => boolean;
  readonly onOwnerRead?: () => void;
  /** Runs when a first-run vault is written (a winner of a creation race). */
  readonly onCreate?: () => void;
  readonly onRestriction?: () => void;
  readonly preferencesStore?: ReturnType<typeof createPreferencesStore>;
  readonly restriction?: string | null;
  readonly session?: ReturnType<typeof createUnlockSession>;
};

/** The router over a key-import wallet double, with what it was asked to do. */
export const keyHarness = (owner: OwnerAnswer | undefined, options: KeyAddressOptions = {}) => {
  const seen = {
    creates: [] as CreateKeyVaultInput[],
    imports: [] as ImportRawKeyAccountInput[],
    ownerReads: [] as OwnerRead[],
    previews: [] as PreviewImportedAccountInput[],
  };
  const base = createWallet();
  const wallet = {
    ...base,
    async createKeyVault(input: CreateKeyVaultInput) {
      seen.creates.push(input);
      options.onCreate?.();
      return account;
    },
    async importRawKeyAccount(input: ImportRawKeyAccountInput) {
      seen.imports.push(input);
      return account;
    },
    async previewImportedAccount(input: PreviewImportedAccountInput): Promise<AccountRef> {
      seen.previews.push(input);
      return { ...account, publicKeyX: KEY_PUBLIC };
    },
    async status() {
      return { ...(await base.status()), hasVault: options.hasVault?.() ?? true };
    },
  };
  const restriction = async () => {
    options.onRestriction?.();
    return (options.restriction ?? null) as never;
  };
  const { getAccountOwner: _production, ...withoutReader } = defaultRuntimeRpc;
  const runtimeRpc = {
    ...withoutReader,
    ...(owner === undefined
      ? {}
      : {
          async getAccountOwner(input: OwnerRead) {
            seen.ownerReads.push(input);
            options.onOwnerRead?.();
            const answer = typeof owner === "function" ? owner(input) : owner;
            if (answer instanceof Error) throw answer;
            return answer;
          },
        }),
    getArgentSigningRestriction: restriction,
    getBraavosSigningRestriction: restriction,
  };
  const session = options.session ?? createUnlockSession();
  if (options.session === undefined) session.unlock(vaultPassphrase);
  const preferencesStore =
    options.preferencesStore ?? createPreferencesStore({ store: createMemoryStore() });
  const handler = createMessageHandler(wallet, testExtension, {
    preferencesStore,
    runtimeRpc,
    session,
  });
  return { handler, preferencesStore, seen, session };
};

/** The lookup message for {@link PASTED}, or another address. */
export const lookupMessage = (address: string = PASTED, extra: Record<string, unknown> = {}) => ({
  address,
  networkId: "SN_MAIN",
  privateKey: KEY,
  type: "wallet.findKeyAccountByAddress",
  ...extra,
});

/** An in-wallet import of the account found at {@link PASTED}. */
export const importByAddress = (extra: Record<string, unknown> = {}) => ({
  accountContractType: "argent",
  address: PASTED,
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  networkId: "SN_MAIN",
  privateKey: KEY,
  type: "wallet.importAccount",
  ...extra,
});

/** The first-run variant: a new vault holding the account found at {@link PASTED}. */
export const createByAddress = (extra: Record<string, unknown> = {}) => ({
  ...importByAddress(),
  type: "wallet.createKeyVault",
  vaultPassphrase,
  ...extra,
});

/** The account at {@link PASTED}, owned by this key, as both sources report it. */
export const owned = argentOwner(KEY_PUBLIC);
