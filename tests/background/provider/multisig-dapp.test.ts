/**
 * A selected Argent multisig can be granted to a site, sign a one-signer
 * login, and save a higher-threshold transaction as an intent. Single-signer
 * grants stay on the vault path.
 */
import { describe, expect, test } from "bun:test";
import { memoryMultisigStore } from "@bramble/multisig/repository";
import { createPreferencesStore } from "@bramble/settings/preferences";
import {
  ARGENT_MULTISIG_CONTRACT,
  normalizeArgentMultisigConfig,
} from "@bramble/starknet/account-contracts";
import { prepareArgentMultisigInvokeV3WithProvider } from "@bramble/starknet/multisig-invoke";
import { createMemoryStore } from "@bramble/store/kv";
import type { AccountRef } from "@bramble/wallet-model/accounts";
import { STARKNET_NETWORKS } from "@bramble/wallet-model/networks";
import { RpcProvider } from "starknet";
import { MULTISIG_PROPOSAL_SAVED } from "../../../apps/extension/src/background/provider/multisig-dapp-invoke";
import { memoryMultisigGrantStore } from "../../../apps/extension/src/background/provider/multisig-grants";
import { createMessageHandler } from "../../../apps/extension/src/background/routing/messages";
import { createUnlockSession } from "../../../apps/extension/src/background/runtime/session";
import {
  account,
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
  testExtension,
  vaultPassphrase,
} from "../../support/background-wallet-stub";
import { latestApprovalId, reviewedApprovalFee, waitForPendingApprovals } from "../../support/held";
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

const multisig = (threshold: number) => ({
  accountContractType: "argent-multisig" as const,
  address: "0x123",
  classHash: ARGENT_MULTISIG_CONTRACT.classHash,
  currentConfig: normalizeArgentMultisigConfig({
    signerPublicKeys: threshold === 1 ? ["0xabc"] : ["0x123", "0x456"],
    threshold,
  }),
  id: "SN_MAIN:0x123",
  networkId: "SN_MAIN" as const,
});

const typedData = {
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

const invokeCalls = [{ calldata: ["0x3"], contractAddress: "0x2", entrypoint: "transfer" }];

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

const harness = async (threshold: number) => {
  const preferences = createPreferencesStore({ store: createMemoryStore() });
  await preferences.setActiveNetwork("SN_MAIN");
  const record = multisig(threshold);
  await preferences.setSelectedMultisig({ multisigId: record.id });
  const multisigs = memoryMultisigStore();
  expect(await multisigs.upsertMultisig(record)).toBe("stored");
  const session = createUnlockSession();
  session.unlock(vaultPassphrase);
  const handler = createMessageHandler(
    createWallet({ accounts: [SIGNER], activeAccountId: () => SIGNER.id }),
    testExtension,
    {
      multisigGrants: memoryMultisigGrantStore(),
      multisigStore: multisigs,
      preferencesStore: preferences,
      runtimeRpc: {
        ...makeRuntimeRpc({
          async estimateMultisigDappFee() {
            return { overallFee: "10", unit: "FRI" };
          },
          async getClassHashAt() {
            return ARGENT_MULTISIG_CONTRACT.classHash;
          },
          async submitMultisigDappInvoke() {
            return { transactionHash: "0x7cd" };
          },
        }),
        multisig: {
          async getConfig() {
            throw new Error("unused");
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
  return { handler, multisigs, record };
};

describe("multisig dapp accounts", () => {
  test("a single-signer grant is unchanged when no multisig is selected", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(createWallet(), testExtension, { session });
    await expect(
      handler({ origin: grantedOrigin, type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toEqual({ accounts: [account], ok: true });
  });

  test("connecting a selected multisig gives the site that address", async () => {
    const { handler, record } = await harness(1);
    const held = handler({ origin: grantedOrigin, type: "wallet.requestAccounts" }, contentSender);
    const id = await latestApprovalId(handler, extensionSender);
    const approved = await handler(
      { id, reviewedAccountId: record.id, type: "wallet.approveOrigin" },
      extensionSender,
    );
    expect(approved).toMatchObject({
      accounts: [{ address: record.address, id: record.id }],
      ok: true,
    });
    await expect(held).resolves.toMatchObject({
      accounts: [{ address: record.address }],
      ok: true,
    });
    await expect(
      handler({ origin: grantedOrigin, type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toMatchObject({ accounts: [{ address: record.address }], ok: true });
  });

  test("a one-signer multisig returns the aggregate a login check accepts", async () => {
    const { handler, record } = await harness(1);
    const connect = handler(
      { origin: grantedOrigin, type: "wallet.requestAccounts" },
      contentSender,
    );
    const connectId = await latestApprovalId(handler, extensionSender);
    await handler(
      { id: connectId, reviewedAccountId: record.id, type: "wallet.approveOrigin" },
      extensionSender,
    );
    await connect;

    const held = handler(
      { origin: grantedOrigin, type: "wallet.signTypedData", typedData },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({
      ok: true,
      signature: ["1", "0", "0xabc", "0x1", "0x2"],
    });
  });

  test("a one-signer multisig submits the site transaction", async () => {
    const { handler, record } = await harness(1);
    const connect = handler(
      { origin: grantedOrigin, type: "wallet.requestAccounts" },
      contentSender,
    );
    const connectId = await latestApprovalId(handler, extensionSender);
    await handler(
      { id: connectId, reviewedAccountId: record.id, type: "wallet.approveOrigin" },
      extensionSender,
    );
    await connect;
    const held = handler(
      { calls: invokeCalls, origin: grantedOrigin, type: "wallet.addInvokeTransaction" },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);
    await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ ok: true, transactionHash: "0x7cd" });
  });

  test("a multisig that needs more than one signer refuses a login", async () => {
    const { handler, record } = await harness(2);
    const connect = handler(
      { origin: grantedOrigin, type: "wallet.requestAccounts" },
      contentSender,
    );
    const connectId = await latestApprovalId(handler, extensionSender);
    await handler(
      { id: connectId, reviewedAccountId: record.id, type: "wallet.approveOrigin" },
      extensionSender,
    );
    await connect;
    await expect(
      handler({ origin: grantedOrigin, type: "wallet.signTypedData", typedData }, contentSender),
    ).resolves.toEqual({ error: "This multisig needs more than one signer." });
  });

  test("a higher threshold saves the site transaction for the other signers", async () => {
    const { handler, multisigs, record } = await harness(2);
    const connect = handler(
      { origin: grantedOrigin, type: "wallet.requestAccounts" },
      contentSender,
    );
    const connectId = await latestApprovalId(handler, extensionSender);
    await handler(
      { id: connectId, reviewedAccountId: record.id, type: "wallet.approveOrigin" },
      extensionSender,
    );
    await connect;

    const held = handler(
      { calls: invokeCalls, origin: grantedOrigin, type: "wallet.addInvokeTransaction" },
      contentSender,
    );
    const pending = await waitForPendingApprovals<{ id: string; multisigThreshold?: number }>(
      handler,
      extensionSender,
    );
    expect(pending.at(-1)?.multisigThreshold).toBe(2);
    const id = pending.at(-1)?.id ?? "";
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);
    await expect(
      handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender),
    ).resolves.toMatchObject({ ok: true });
    await expect(held).resolves.toEqual({ error: MULTISIG_PROPOSAL_SAVED });
    const intents = await multisigs.listIntents();
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ accountId: record.id, state: "collecting" });
  });
});
