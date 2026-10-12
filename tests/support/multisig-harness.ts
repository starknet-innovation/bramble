/**
 * Shared deterministic harness for privileged Argent multisig messages.
 */

import type { ArgentUnsupportedSigner } from "@bramble/multisig/chain";
import type { NostrCoordinationStore } from "@bramble/multisig/coordination";
import { type MultisigStore, memoryMultisigStore } from "@bramble/multisig/repository";
import type { MultisigSignerAccount } from "@bramble/multisig/signer-account";
import { createPreferencesStore } from "@bramble/settings/preferences";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
  argentAccountAddress,
  argentMultisigAddress,
  argentSignerGuid,
} from "@bramble/starknet/account-contracts";
import { prepareArgentMultisigInvokeV3WithProvider } from "@bramble/starknet/multisig-invoke";
import { createMemoryStore } from "@bramble/store/kv";
import { memoryActivityLog, systemClock } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import type { NostrApplicationData } from "@bramble/vault/kms-port";
import type { Vault } from "@bramble/vault/schema";
import type { WalletVaultService } from "@bramble/vault/service-types";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { ec, RpcProvider } from "starknet";
import type { NostrRelayTransport } from "../../apps/extension/src/background/multisig/nostr-relay";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import type { RuntimeRpc } from "../../apps/extension/src/background/runtime/runtime-rpc";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";
import { testExtension } from "./background-wallet-stub";

const HARNESS_PRIVATE_A = "0x123";
const HARNESS_PRIVATE_B = "0x456";
const HARNESS_PUBLIC_A = `0x${ec.starkCurve.getStarkKey(HARNESS_PRIVATE_A).replace(/^0x/, "")}`;
const HARNESS_PUBLIC_B = `0x${ec.starkCurve.getStarkKey(HARNESS_PRIVATE_B).replace(/^0x/, "")}`;
export const HARNESS_KEYS = [HARNESS_PUBLIC_A, HARNESS_PUBLIC_B].sort((left, right) =>
  BigInt(argentSignerGuid(left)) < BigInt(argentSignerGuid(right)) ? -1 : 1,
);
const HARNESS_CONFIG = { signerPublicKeys: HARNESS_KEYS, threshold: 2 } as const;
const HARNESS_MULTISIG = argentMultisigAddress(HARNESS_CONFIG, "0x0");
export const HARNESS_MULTISIG_ID = `SN_MAIN:${HARNESS_MULTISIG}`;
export const HARNESS_TARGET = "0x222";
const HARNESS_SUBMIT_HASH = "0x7cd";

const accountFor = (publicKeyX: string): AccountRef => {
  const address = argentAccountAddress(publicKeyX);
  return {
    accountContractType: "argent",
    address,
    classHash: ARGENT_ACCOUNT_CONTRACT.classHash,
    derivation: { kind: "imported-raw-key" },
    deploymentSalt: publicKeyX,
    id: `SN_MAIN:${address}`,
    networkId: "SN_MAIN",
    publicKeyX,
  };
};

export const harnessAccountA = accountFor(HARNESS_PUBLIC_A);
export const harnessAccountB = accountFor(HARNESS_PUBLIC_B);

export const harnessExtensionSender: RuntimeSender = {
  id: "extension-id",
  url: "chrome-extension://extension-id/sidepanel.html",
};

export const harnessContentSender: RuntimeSender = {
  id: "extension-id",
  url: "https://dapp.example/app",
};

const provider = new RpcProvider({ nodeUrl: "http://127.0.0.1:5050/rpc" });
provider.getChainId = async () => "0x534e5f4d41494e";
provider.getNonceForAddress = async () => "0x7";
provider.getEstimateFeeBulk = (async () => [
  {
    data_gas_consumed: 0n,
    data_gas_price: 0n,
    gas_consumed: 0n,
    gas_price: 0n,
    overall_fee: 44n,
    resourceBounds: {
      l1_data_gas: { max_amount: 1n, max_price_per_unit: 2n },
      l1_gas: { max_amount: 3n, max_price_per_unit: 4n },
      l2_gas: { max_amount: 5n, max_price_per_unit: 6n },
    },
    unit: "FRI" as const,
  },
]) as RpcProvider["getEstimateFeeBulk"];

/**
 * Harness controls for fresh-chain and response-loss branches.
 */
export type MultisigHarnessOptions = {
  readonly beforeAccountDeployment?: () => Promise<void> | void;
  readonly beforeSubmitPrepared?: () => Promise<void> | void;
  readonly coordination?: {
    readonly open: (eventJson: string) => Promise<NostrApplicationData>;
    readonly publicKey: string;
    readonly transport: NostrRelayTransport;
    readonly wrap: (input: {
      readonly content: string;
      readonly identifier: string;
      readonly recipientPublicKey: string;
    }) => Promise<string>;
  };
  readonly deploymentBalance?: string | null;
  readonly deploymentEstimateError?: Error;
  readonly deploymentStatus?: boolean | (() => boolean);
  readonly failPreferencesAfterSubmit?: boolean;
  readonly getConfig?: () =>
    | {
        readonly classHash: string;
        readonly signerGuids: readonly string[];
        readonly threshold: number;
      }
    | Promise<{
        readonly classHash: string;
        readonly signerGuids: readonly string[];
        readonly threshold: number;
      }>;
  readonly getSignerPublicKeys?: () => {
    readonly signerPublicKeys: readonly string[];
    readonly unsupportedSigners: readonly ArgentUnsupportedSigner[];
  };
  readonly resolveSignerAccount?: () => MultisigSignerAccount;
  readonly multisigStore?: MultisigStore;
  readonly getNonce?: () => string;
  /** Replaces the default balance read, e.g. with the real reader over a fake provider. */
  readonly getTokenBalances?: RuntimeRpc["getTokenBalances"];
  readonly getTransactionStatuses?: (
    transactionHash: string,
  ) => Promise<
    Readonly<Record<string, { finalizedOnL1: boolean; found: boolean; status: "pending" }>>
  >;
  readonly nonce?: string;
  readonly nostrCoordinationStore?: NostrCoordinationStore;
  readonly now?: () => number;
  readonly onSigned?: () => void;
  readonly submitAccountDeployment?: () => Promise<string>;
  readonly submitPrepared?: (transactionHash: string) => Promise<string>;
  readonly watchedOnly?: boolean;
};

/**
 * Creates a fully unlocked router with real signature and prepared-hash math.
 */
export const makeMultisigHarness = async (options: MultisigHarnessOptions = {}) => {
  const accounts = [harnessAccountA, harnessAccountB];
  const privateKeys = new Map([
    [harnessAccountA.id, HARNESS_PRIVATE_A],
    [harnessAccountB.id, HARNESS_PRIVATE_B],
  ]);
  const multisigStore = options.multisigStore ?? memoryMultisigStore();
  const storedPreferences = createPreferencesStore({ store: createMemoryStore() });
  // The background and its activity log share one clock, as in production.
  const activity = memoryActivityLog(options.now ?? systemClock);
  const allowanceStore = memoryAllowanceStore();
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  let submitCount = 0;
  let deploymentSubmitCount = 0;
  let submitted = false;
  const preferencesStore = {
    ...storedPreferences,
    async read() {
      if (options.failPreferencesAfterSubmit && submitted) {
        throw new Error("preferences unavailable after broadcast");
      }
      return storedPreferences.read();
    },
  };
  let activeAccountId = harnessAccountA.id;
  const wallet = {
    async addDerivedAccount() {
      return harnessAccountA;
    },
    async createAccount() {
      return harnessAccountA;
    },
    async ensureNetworkAccount() {
      return harnessAccountA;
    },
    async generateMnemonic() {
      return "unused";
    },
    async getGrantedAccounts() {
      return accounts;
    },
    async grantOrigin() {
      return accounts;
    },
    async importRawKeyAccount() {
      return harnessAccountA;
    },
    ...(options.coordination
      ? {
          async nostrPublicKey() {
            return options.coordination?.publicKey ?? "";
          },
          async openNostrApplicationData(input: { readonly eventJson: string }) {
            if (!options.coordination) throw new Error("coordination unavailable");
            return options.coordination.open(input.eventJson);
          },
          async openNostrApplicationDataBatch(
            input: Parameters<WalletVaultService["openNostrApplicationDataBatch"]>[0],
          ) {
            if (!options.coordination) throw new Error("coordination unavailable");
            const opened: Array<NostrApplicationData | null> = [];
            for (const eventJson of input.eventJsons) {
              if (!input.isAuthorized()) throw new Error("wallet locked");
              try {
                opened.push(await options.coordination.open(eventJson));
              } catch {
                opened.push(null);
              }
            }
            return opened;
          },
          async wrapNostrApplicationData(input: {
            readonly content: string;
            readonly identifier: string;
            readonly recipientPublicKey: string;
          }) {
            if (!options.coordination) throw new Error("coordination unavailable");
            return options.coordination.wrap(input);
          },
          async wrapNostrApplicationDataBatch(
            input: Parameters<WalletVaultService["wrapNostrApplicationDataBatch"]>[0],
          ) {
            if (!options.coordination) throw new Error("coordination unavailable");
            const wrapped: Array<string | null> = [];
            for (const item of input.items) {
              if (!input.isAuthorized()) throw new Error("wallet locked");
              try {
                wrapped.push(await options.coordination.wrap(item));
              } catch {
                wrapped.push(null);
              }
            }
            return wrapped;
          },
        }
      : {}),
    async readVault() {
      return { accounts, activeAccountId } as unknown as Vault;
    },
    async setActiveAccount(input: { readonly accountId: string }) {
      activeAccountId = input.accountId;
      return accounts.find((account) => account.id === input.accountId) ?? harnessAccountA;
    },
    async signHash(input: { readonly accountId?: string; readonly messageHash: string }) {
      const accountId = input.accountId ?? activeAccountId;
      const privateKey = privateKeys.get(accountId);
      const account = accounts.find((candidate) => candidate.id === accountId);
      if (!privateKey || !account) throw new Error("unknown signer");
      const signed = ec.starkCurve.sign(input.messageHash, privateKey);
      options.onSigned?.();
      return {
        publicKey: account.publicKeyX,
        r: `0x${signed.r.toString(16)}`,
        s: `0x${signed.s.toString(16)}`,
      };
    },
    async status() {
      return {
        accountCount: accounts.length,
        activeAccountId,
        hasVault: true,
        locked: false,
        ready: false,
      };
    },
  };
  const handler = createMessageHandler(wallet, testExtension, {
    activity,
    allowanceStore,
    multisigStore,
    ...(options.nostrCoordinationStore
      ? { nostrCoordinationStore: options.nostrCoordinationStore }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.coordination ? { nostrRelayTransport: options.coordination.transport } : {}),
    preferencesStore,
    runtimeRpc: {
      async estimateAccountDeploymentFee() {
        if (options.deploymentEstimateError) throw options.deploymentEstimateError;
        return { overallFee: "44", unit: "FRI" };
      },
      async estimateInvokeFee() {
        return { overallFee: "44", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return typeof options.deploymentStatus === "function"
          ? options.deploymentStatus()
          : (options.deploymentStatus ?? false);
      },
      async getNftOwner() {
        return harnessAccountA.address;
      },
      async getTokenBalances(input) {
        if (options.getTokenBalances) return options.getTokenBalances(input);
        const { tokens } = input;
        const balance = options.deploymentBalance;
        return balance === null || balance === undefined
          ? []
          : tokens.map((token) => ({
              ...token,
              balance,
              formatted: balance,
            }));
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Ether", symbol: "ETH" };
      },
      async getTransactionStatuses(input) {
        const transactionHash = input.hashes[0] ?? "";
        return options.getTransactionStatuses?.(transactionHash) ?? {};
      },
      multisig: {
        async getConfig() {
          return (
            (await options.getConfig?.()) ?? {
              classHash: ARGENT_MULTISIG_CONTRACT.classHash,
              signerGuids: HARNESS_KEYS.map(argentSignerGuid),
              threshold: 2,
            }
          );
        },
        async getSignerPublicKeys() {
          return (
            options.getSignerPublicKeys?.() ?? {
              signerPublicKeys: HARNESS_KEYS,
              unsupportedSigners: [],
            }
          );
        },
        async getNonce() {
          return options.getNonce?.() ?? options.nonce ?? "0x7";
        },
        async isClassDeclared() {
          return true;
        },
        async prepareInvoke(input) {
          provider.getNonceForAddress = async () => options.getNonce?.() ?? options.nonce ?? "0x7";
          return prepareArgentMultisigInvokeV3WithProvider(
            provider,
            input.account,
            input.calls,
            input.config,
          );
        },
        async resolveSignerAccount() {
          return (
            options.resolveSignerAccount?.() ?? {
              accountContractType: "argent",
              address: harnessAccountA.address,
              publicKeyX: harnessAccountA.publicKeyX,
            }
          );
        },
        async submitPreparedInvoke(input) {
          await options.beforeSubmitPrepared?.();
          if (!input.isAuthorized?.()) throw new Error("wallet locked");
          submitCount += 1;
          submitted = true;
          return (
            options.submitPrepared?.(input.prepared.transactionHash) ??
            input.prepared.transactionHash
          );
        },
      },
      async submitAccountDeployment(input) {
        await options.beforeAccountDeployment?.();
        if (!input.isAuthorized?.()) throw new Error("wallet locked");
        deploymentSubmitCount += 1;
        return {
          transactionHash: (await options.submitAccountDeployment?.()) ?? HARNESS_SUBMIT_HASH,
        };
      },
      async submitDeclareTransaction() {
        throw new Error("declare is not part of Argent multisig");
      },
      async submitErc20Transfer() {
        throw new Error("unused");
      },
      async submitInvokeTransaction() {
        throw new Error("old invoke path must not be used");
      },
    },
    session,
  });
  await multisigStore.upsertMultisig({
    accountContractType: "argent-multisig",
    address: HARNESS_MULTISIG,
    classHash: ARGENT_MULTISIG_CONTRACT.classHash,
    ...(options.watchedOnly
      ? {}
      : {
          currentConfig: { signerPublicKeys: HARNESS_KEYS, threshold: 2 },
          deployment: { salt: "0x0", signerPublicKeys: HARNESS_KEYS, threshold: 2 },
        }),
    id: HARNESS_MULTISIG_ID,
    networkId: "SN_MAIN",
  });
  return {
    activeAccountId: () => activeAccountId,
    deploymentSubmitCount: () => deploymentSubmitCount,
    activity,
    allowanceStore,
    handler,
    multisigStore,
    preferencesStore,
    session,
    submitCount: () => submitCount,
  };
};
