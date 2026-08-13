/**
 * Shared deterministic harness for privileged Argent multisig messages.
 */
import { type MultisigStore, memoryMultisigStore } from "@mc-wallet/multisig/repository";
import { createPreferencesStore } from "@mc-wallet/settings/preferences";
import {
  ARGENT_ACCOUNT_CONTRACT,
  ARGENT_MULTISIG_CONTRACT,
  argentAccountAddress,
  argentMultisigAddress,
  argentSignerGuid,
} from "@mc-wallet/starknet/account-contracts";
import { prepareArgentMultisigInvokeV3WithProvider } from "@mc-wallet/starknet/multisig-invoke";
import { createMemoryStore } from "@mc-wallet/store/kv";
import { memoryActivityLog } from "@mc-wallet/transactions/activity";
import type { Vault } from "@mc-wallet/vault/schema";
import type { AccountRef } from "@mc-wallet/wallet-model/accounts";
import { ec, RpcProvider } from "starknet";
import { createMessageHandler } from "../../apps/extension/src/background/routing/messages";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import { createUnlockSession } from "../../apps/extension/src/background/runtime/session";

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
  readonly getConfig?: () => {
    readonly classHash: string;
    readonly signerGuids: readonly string[];
    readonly threshold: number;
  };
  readonly multisigStore?: MultisigStore;
  readonly getNonce?: () => string;
  readonly nonce?: string;
  readonly submitAccountDeployment?: () => Promise<string>;
  readonly submitPrepared?: (transactionHash: string) => Promise<string>;
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
  const preferencesStore = createPreferencesStore({ store: createMemoryStore() });
  const activity = memoryActivityLog();
  const session = createUnlockSession();
  session.unlock("correct horse battery staple");
  let submitCount = 0;
  let deploymentSubmitCount = 0;
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
  const handler = createMessageHandler(wallet, "extension-id", {
    activity,
    multisigStore,
    preferencesStore,
    runtimeRpc: {
      async estimateAccountDeploymentFee() {
        return { overallFee: "44", unit: "FRI" };
      },
      async estimateInvokeFee() {
        return { overallFee: "44", unit: "FRI" };
      },
      async getDeploymentStatus() {
        return true;
      },
      async getNftOwner() {
        return harnessAccountA.address;
      },
      async getTokenBalances() {
        return [];
      },
      async getTokenMetadata() {
        return { decimals: 18, name: "Ether", symbol: "ETH" };
      },
      async getTransactionStatuses() {
        return {};
      },
      multisig: {
        async getConfig() {
          return (
            options.getConfig?.() ?? {
              classHash: ARGENT_MULTISIG_CONTRACT.classHash,
              signerGuids: HARNESS_KEYS.map(argentSignerGuid),
              threshold: 2,
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
            input.options,
          );
        },
        async submitPreparedInvoke(input) {
          submitCount += 1;
          return (
            options.submitPrepared?.(input.prepared.transactionHash) ??
            input.prepared.transactionHash
          );
        },
      },
      async submitAccountDeployment() {
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
    currentConfig: { signerPublicKeys: HARNESS_KEYS, threshold: 2 },
    deployment: { salt: "0x0", signerPublicKeys: HARNESS_KEYS, threshold: 2 },
    id: HARNESS_MULTISIG_ID,
    networkId: "SN_MAIN",
  });
  return {
    deploymentSubmitCount: () => deploymentSubmitCount,
    activity,
    handler,
    multisigStore,
    session,
    submitCount: () => submitCount,
  };
};
