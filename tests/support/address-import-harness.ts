/**
 * Shared harness for the import-by-address background tests (issue 398): a
 * wallet whose previews derive deterministic per-ladder keys, a vault whose
 * phrase can be scripted across reads, and an owner reader that answers per
 * source so one endpoint can be made to lie.
 */
import { createPreferencesStore } from "@bramble/settings/preferences";
import type { AccountOwnerReading } from "@bramble/starknet/rpc";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountDerivationInput } from "@bramble/vault/accounts";
import type { RecoverVaultAccountsInput } from "@bramble/vault/service";
import { ARGENT_ACCOUNT_CLASS_HASH } from "@bramble/wallet-model/account-families";
import type { RecoverableAccountRef } from "@bramble/wallet-model/accounts";
import { canonicalFelt } from "@bramble/wallet-model/networks";
import type { RecoveryAccountSelection } from "@bramble/wallet-model/recovery";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import { defaultRuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { account, createWallet, testExtension, vaultPassphrase } from "./background-wallet-stub";

export const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
export const PASTED = "0x7e57ad0e55";

// Deterministic public keys, distinct per ladder: this wallet's own ladder,
// Ready's ETH-seeded one, and Braavos's address axis.
export const keyFor = (family: string, derivation: string | undefined, index: number): string =>
  `0x${family === "braavos" ? "3" : derivation === "argentx-bip44" ? "2" : "1"}${index.toString(16)}`;

const previewFor = (input: AccountDerivationInput): RecoverableAccountRef => {
  const index = input.accountIndex ?? 0;
  const publicKeyX = keyFor(input.accountContractType, input.derivation, index);
  const address = canonicalFelt(`0x${publicKeyX.slice(2)}aa`) as string;
  const networkId = input.networkId ?? "SN_MAIN";
  const core = {
    address,
    classHash: canonicalFelt(input.classHash ?? ARGENT_ACCOUNT_CLASS_HASH) as string,
    id: `${networkId}:${address}`,
    networkId,
    publicKeyX,
  } as const;
  if (input.derivation === "argentx-bip44") {
    return {
      ...core,
      accountContractType: "argent",
      deploymentSalt: publicKeyX,
      derivation: { addressIndex: index, kind: "argentx-bip44" },
    };
  }
  return {
    ...core,
    accountContractType: input.accountContractType as "argent" | "braavos",
    deploymentSalt: publicKeyX,
    derivation:
      input.accountContractType === "braavos"
        ? { accountIndex: 0, addressIndex: index, kind: "starknet-bip44" }
        : { accountIndex: index, addressIndex: 0, kind: "starknet-bip44" },
    publicKeyY: "0x5",
  };
};

export type OwnerRead = {
  readonly accountAddress: string;
  readonly chainId: string;
  readonly rpcUrls: readonly string[];
};

// What the chain answers: one reading for every source, or per source.
type OwnerAnswer =
  | AccountOwnerReading
  | Error
  | undefined
  | ((input: OwnerRead) => AccountOwnerReading | Error);

type Harness = {
  readonly imports: RecoverVaultAccountsInput[];
  readonly ownerReads: OwnerRead[];
  readonly previews: AccountDerivationInput[];
  readonly recovers: RecoverVaultAccountsInput[];
};

export const harness = (
  owner: OwnerAnswer,
  options: {
    readonly mnemonic?: string | null;
    /** Phrases the vault reports on successive reads (replaced-vault races). */
    readonly mnemonics?: readonly (string | null)[];
    readonly onOwnerRead?: () => void;
    readonly onPreview?: (input: AccountDerivationInput) => void;
    readonly onRestriction?: () => void;
    readonly preferencesStore?: ReturnType<typeof createPreferencesStore>;
    readonly restriction?: string | null;
    readonly session?: ReturnType<typeof createUnlockSession>;
  } = {},
) => {
  let vaultReads = 0;
  const seen: Harness = { imports: [], ownerReads: [], previews: [], recovers: [] };
  const base = createWallet();
  const wallet = {
    ...base,
    async importSeedAccounts(input: RecoverVaultAccountsInput) {
      seen.imports.push(input);
      return [account];
    },
    async previewAccount(input: AccountDerivationInput) {
      seen.previews.push(input);
      options.onPreview?.(input);
      return previewFor(input);
    },
    async readVault(passphrase: string) {
      const vault = await base.readVault(passphrase);
      const scripted = options.mnemonics?.[Math.min(vaultReads, options.mnemonics.length - 1)];
      vaultReads += 1;
      const mnemonic =
        options.mnemonics !== undefined
          ? (scripted ?? null)
          : options.mnemonic === undefined
            ? PHRASE
            : options.mnemonic;
      return { ...vault, mnemonic };
    },
    async recoverAccounts(input: RecoverVaultAccountsInput) {
      seen.recovers.push(input);
      return [account];
    },
  };
  const restriction = async () => {
    options.onRestriction?.();
    return (options.restriction ?? null) as never;
  };
  // The production wiring has a reader; "no reader at all" drops it.
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
  const handler = createMessageHandler(wallet, testExtension, {
    preferencesStore:
      options.preferencesStore ?? createPreferencesStore({ store: createMemoryStore() }),
    runtimeRpc,
    session,
  });
  return { handler, seen, session };
};

/** An Argent 0.4.0 account owned by `ownerPublicKey`, as both sources would report it. */
export const argentOwner = (
  ownerPublicKey: string,
): Extract<AccountOwnerReading, { readonly kind: "owner" }> => ({
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  family: "argent",
  kind: "owner",
  ownerPublicKey,
});

export const findMessage = (networkId = "SN_MAIN", address = PASTED) => ({
  address,
  mnemonic: PHRASE,
  networkId,
  type: "wallet.findRecoveryAccountByAddress",
});

/** A Ready-ladder pick at `index` found by the pasted address. */
export const pick = (index: number): RecoveryAccountSelection => ({
  accountContractType: "argent",
  accountIndex: index,
  address: PASTED,
  classHash: ARGENT_ACCOUNT_CLASS_HASH,
  derivation: "argentx-bip44",
});
