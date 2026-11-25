/**
 * The wallet every block of the multisig-import fixture runs in (see `./index.ts`): G5's 2-of-3
 * Sepolia multisig, a vault holding member account 0, one saved contact, and the background's
 * own collaborators (memory stores, an unlocked session on a fixed clock) with the two chain reads
 * an import makes, the authority and the nonce, answered from the case. Every value is public.
 */
import { createKrustyKms } from "@bramble/kms-krusty/adapter";
import type { ArgentMultisigCall, ArgentMultisigConfig } from "@bramble/multisig/chain";
import {
  type ArgentMultisigRecord,
  type ArgentMultisigSigningIntent,
  type MultisigStore,
  memoryMultisigStore,
} from "@bramble/multisig/repository";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { argentSignerGuid } from "@bramble/starknet/account-contracts";
import { prepareArgentMultisigInvokeV3 } from "@bramble/starknet/multisig-invoke";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { deriveAccount } from "@bramble/vault/accounts";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { canonicalAddress } from "@bramble/wallet-model/networks";
import type { MultisigOpsDeps } from "../../apps/extension/src/background/multisig/multisig-deps";
import { sortedArgentMultisigSignatures } from "../../apps/extension/src/background/multisig/multisig-inputs";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import {
  type MultisigSigner,
  multisigRecord,
  multisigSigners,
  newRecorder,
  proposedIntent,
  signAs,
  withCannedNode,
} from "../mobile-multisig-transactions";
import { CONTACT } from "../mobile-parity-calls/shared";
import { PLACEHOLDER_URLS, TRANSACTION_MNEMONIC } from "../mobile-transactions-capture";

const NETWORK = "SN_SEPOLIA";
/** The nonce G5's canned node holds the deployed multisig at, so every prepared intent's nonce. */
export const NONCE = "0x5";
/** The fixed instant the session and activity log read. */
const NOW = 1_790_000_000_000;
const PASSPHRASE = "parity-session";

/** What one case lets the chain answer: the authority read (or its failure) and the nonce. */
export type ChainReads = {
  readonly authority: ArgentMultisigConfig | { readonly error: string };
  readonly nonce: string;
};

/** The fixture's keys, record and vault, derived once. */
export type Setup = {
  readonly record: ArgentMultisigRecord;
  readonly signers: readonly MultisigSigner[];
  /** Member account 0 on Sepolia, the active account. */
  readonly vaultAccount: AccountRef;
  /** The vault: that account on Sepolia and on Mainnet, so either network has an account. */
  readonly vaultAccounts: readonly AccountRef[];
};

/** The Sepolia multisig and member account 0 of the published phrase as the vault. */
export const loadSetup = async (): Promise<Setup> => {
  const signers = await multisigSigners(NETWORK);
  const kms = createKrustyKms(await import("@starknetfoundation/krusty-kms-wasm"));
  const vaultAccounts: AccountRef[] = [];
  for (const networkId of [NETWORK, "SN_MAIN"] as const) {
    const { account } = await deriveAccount(kms, {
      accountContractType: "openzeppelin",
      accountIndex: 0,
      mnemonic: TRANSACTION_MNEMONIC,
      networkId,
    });
    vaultAccounts.push(account);
  }
  const [vaultAccount] = vaultAccounts as [AccountRef];
  return { record: multisigRecord(NETWORK, signers), signers, vaultAccount, vaultAccounts };
};

/** Options a case changes from the default wallet. */
export type WalletOptions = {
  /** The record the registry holds; the fixture's own when absent, none when null. */
  readonly record?: ArgentMultisigRecord | null;
  readonly activeNetwork?: "SN_MAIN" | "SN_SEPOLIA";
  readonly locked?: boolean;
  /** Wraps the registry, e.g. to answer `getIntent` with another transaction. */
  readonly store?: (store: MultisigStore) => MultisigStore;
};

/**
 * The background's collaborators for one case, and the real registry behind them: when
 * `options.store` wraps it, the handler sees the wrapper but `store` is the registry itself, so
 * what a case records as stored is what was actually written.
 */
export const caseWallet = async (
  setup: Setup,
  reads: ChainReads,
  options: WalletOptions = {},
): Promise<{ readonly deps: MultisigOpsDeps; readonly store: MultisigStore }> => {
  const base = memoryMultisigStore();
  const record = options.record === undefined ? setup.record : options.record;
  if (record) await base.upsertMultisig(record);
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  await preferencesStore.setActiveNetwork(options.activeNetwork ?? NETWORK);
  // G7c's contact, saved on Sepolia; its lookalike is a poisoned payee.
  await preferencesStore.saveAddress({
    address: canonicalAddress(CONTACT) ?? CONTACT,
    label: "Ada",
    networkId: NETWORK,
  });
  const session = createUnlockSession({ now: () => NOW });
  if (!options.locked) session.unlock(PASSPHRASE);
  const vault = { accounts: setup.vaultAccounts, activeAccountId: setup.vaultAccount.id };
  const deps = {
    activity: memoryActivityLog(() => NOW),
    multisigStore: options.store ? options.store(base) : base,
    now: () => NOW,
    preferencesStore,
    runtimeRpc: {
      multisig: {
        async getConfig() {
          if ("error" in reads.authority) throw new Error(reads.authority.error);
          return reads.authority;
        },
        async getNonce() {
          return reads.nonce;
        },
      },
    },
    session,
    wallet: {
      async readVault(passphrase: string) {
        if (passphrase !== PASSPHRASE) throw new Error("wrong passphrase");
        return vault;
      },
    },
  } as unknown as MultisigOpsDeps;
  return { deps, store: base };
};

/** The authority the chain reports for the fixture's multisig, as each intent snapshots it. */
export const currentAuthority = (record: ArgentMultisigRecord): ArgentMultisigConfig => ({
  classHash: record.classHash,
  signerGuids: (record.currentConfig?.signerPublicKeys ?? []).map(argentSignerGuid),
  threshold: record.currentConfig?.threshold ?? 0,
});

/**
 * `calls` prepared for the fixture's multisig at `NONCE` over G5's canned node, without the call
 * review, so a batch the review refuses can still be frozen into an intent a co-signer sends.
 */
const prepareCalls = async (record: ArgentMultisigRecord, calls: readonly ArgentMultisigCall[]) => {
  const config = record.currentConfig;
  if (!config) throw new Error("the fixture multisig has no current config");
  return withCannedNode(newRecorder(true), record, () =>
    prepareArgentMultisigInvokeV3({ account: record, calls, config, rpcUrls: PLACEHOLDER_URLS }),
  );
};

/** `intent` with the signatures of the members at `signerIndexes`, in GUID order, and its state. */
export const withSignatures = async (
  setup: Setup,
  intent: ArgentMultisigSigningIntent,
  signerIndexes: readonly number[],
): Promise<ArgentMultisigSigningIntent> => {
  const signed = [];
  for (const index of signerIndexes) {
    const signer = setup.signers[index];
    if (!signer) throw new Error(`no signer ${index}`);
    signed.push(await signAs(signer, intent.prepared.transactionHash));
  }
  const signatures = sortedArgentMultisigSignatures(signed);
  return {
    ...intent,
    signatures,
    state: signatures.length === intent.configSnapshot.threshold ? "ready" : "collecting",
  };
};

/** A co-signer's intent for `calls`, signed by the members at `signerIndexes`. */
export const intentFor = async (
  setup: Setup,
  calls: readonly ArgentMultisigCall[],
  signerIndexes: readonly number[],
  summary = "Proposed by a co-signer",
): Promise<ArgentMultisigSigningIntent> => {
  const prepared = await prepareCalls(setup.record, calls);
  return withSignatures(setup, proposedIntent(setup.record, prepared, summary), signerIndexes);
};
