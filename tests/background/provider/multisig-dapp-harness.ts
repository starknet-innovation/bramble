/**
 * Shared setup for multisig dapp connect and approval tests.
 */
import { expect } from "bun:test";
import { memoryMultisigStore } from "@bramble/multisig/repository";
import { createPreferencesStore } from "@bramble/settings/preferences";
import {
  ARGENT_MULTISIG_CONTRACT,
  argentSignerGuid,
  normalizeArgentMultisigConfig,
} from "@bramble/starknet/account-contracts";
import { prepareArgentMultisigInvokeV3WithProvider } from "@bramble/starknet/multisig-invoke";
import { createMemoryStore } from "@bramble/store/kv";
import type { ActivityLog } from "@bramble/transactions/activity";
import type { AllowanceStore } from "@bramble/transactions/allowance-store";
import type { RelaySignatureLog } from "@bramble/transactions/relay-signatures";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { RpcProvider } from "starknet";
import { memoryMultisigGrantStore } from "../../../apps/extension/src/background/provider/multisig-grants";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import { createWallet, testExtension, vaultPassphrase } from "../../support/background-wallet-stub";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";

const SIGNER: AccountRef = {
  accountContractType: "openzeppelin",
  address: "0x99",
  classHash: "0x1",
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: "SN_MAIN:0x99",
  networkId: "SN_MAIN",
  publicKeyX: "0xabc",
  publicKeyY: "0xdef",
};

export const multisig = (threshold: number, member = false) => ({
  accountContractType: "argent-multisig" as const,
  address: "0x123",
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  currentConfig: normalizeArgentMultisigConfig({
    signerPublicKeys:
      threshold === 1 ? ["0xabc"] : member ? ["0xabc", "0x456"] : ["0x123", "0x456"],
    threshold,
  }),
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN" as const,
});

export const typedData = {
  domain: { chainId: "SN_MAIN", name: "Bramble Test", revision: "1", version: "1" },
  message: { content: "hello" },
  primaryType: "Message",
  types: {
    Message: [{ name: "content", type: "felt" }],
    StarknetDomain: [
      { name: "name", type: "shortstring" },
      { name: "chainId", type: "shortstring" },
      { name: "version", type: "shortstring" },
      { name: "revision", type: "shortstring" },
    ],
  },
};

export const invokeCalls = [{ calldata: ["0x3"], contractAddress: "0x2", entrypoint: "transfer" }];

const fakeProvider = (): RpcProvider =>
  Object.assign(Object.create(RpcProvider.prototype), {
    channel: { id: "test" },
    async getChainId() {
      return STARKNET_NETWORKS.SN_MAIN.chainId;
    },
    async getEstimateFeeBulk() {
      return [
        {
          overall_fee: 21n,
          resourceBounds: {
            l1_data_gas: { max_amount: 1n, max_price_per_unit: 2n },
            l1_gas: { max_amount: 3n, max_price_per_unit: 4n },
            l2_gas: { max_amount: 5n, max_price_per_unit: 6n },
          },
          unit: "FRI",
        },
      ];
    },
    async getNonceForAddress() {
      return "0x7";
    },
  }) as RpcProvider;

export const harness = async (
  threshold: number,
  options: {
    readonly activity?: ActivityLog;
    readonly allowanceStore?: AllowanceStore;
    readonly classHash?: string;
    readonly fee?: string;
    readonly grantAccountIds?: readonly string[];
    readonly member?: boolean;
    readonly onGrantRead?: () => Promise<void> | void;
    readonly onList?: () => void;
    readonly onSign?: () => void;
    readonly relaySignatures?: RelaySignatureLog;
    readonly signerConfig?:
      | "throw"
      | {
          readonly classHash: string;
          readonly signerGuids: readonly string[];
          readonly threshold: number;
        };
  } = {},
) => {
  const preferences = createPreferencesStore({ store: createMemoryStore() });
  await preferences.setActiveNetwork("SN_MAIN");
  const record = multisig(threshold, options.member === true);
  await preferences.setSelectedMultisig({ multisigId: record.id });
  const stored = memoryMultisigStore();
  expect(await stored.upsertMultisig(record)).toBe("stored");
  const multisigs = {
    ...stored,
    listMultisigs: async () => {
      const records = await stored.listMultisigs();
      options.onList?.();
      return records;
    },
  };
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const grants = memoryMultisigGrantStore();
  const readIds = grants.idsFor.bind(grants);
  const multisigGrants = {
    ...grants,
    idsFor: async (origin: string, credential: string) => {
      const ids = await readIds(origin, credential);
      await options.onGrantRead?.();
      return ids;
    },
  };
  const handler = createMessageHandler(
    createWallet({
      accounts: [SIGNER],
      activeAccountId: () => SIGNER.id,
      ...(options.grantAccountIds ? { grantAccountIds: options.grantAccountIds } : {}),
      ...(options.onSign ? { captureSign: options.onSign } : {}),
    }),
    testExtension,
    {
      ...(options.activity ? { activity: options.activity } : {}),
      ...(options.allowanceStore ? { allowanceStore: options.allowanceStore } : {}),
      multisigGrants,
      multisigStore: multisigs,
      preferencesStore: preferences,
      ...(options.relaySignatures ? { relaySignatures: options.relaySignatures } : {}),
      runtimeRpc: {
        ...makeRuntimeRpc({
          async estimateMultisigDappFee() {
            return { overallFee: options.fee ?? "999999999999999999", unit: "FRI" };
          },
          async getClassHashAt() {
            return options.classHash ?? ARGENT_MULTISIG_CONTRACT.classHash;
          },
          async submitMultisigDappInvoke() {
            return { transactionHash: "0x7cd" };
          },
        }),
        multisig: {
          async getConfig() {
            if (options.signerConfig === "throw") throw new Error("config unavailable");
            const stored = record.currentConfig;
            return (
              options.signerConfig ?? {
                classHash: record.classHash,
                signerGuids: (stored?.signerPublicKeys ?? []).map((key) => argentSignerGuid(key)),
                threshold: stored?.threshold ?? 0,
              }
            );
          },
          async getNonce() {
            return "0x1";
          },
          async isClassDeclared() {
            return true;
          },
          prepareInvoke: () =>
            prepareArgentMultisigInvokeV3WithProvider(
              fakeProvider(),
              record,
              invokeCalls,
              record.currentConfig,
            ),
          async submitPreparedInvoke() {
            return "0x1";
          },
        },
      },
      session,
    },
  );
  return { grants, handler, multisigs, preferences, record, session };
};
