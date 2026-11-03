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

const multisig = (threshold: number, member = false) => ({
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

const harness = async (
  threshold: number,
  options: {
    readonly classHash?: string;
    readonly fee?: string;
    readonly member?: boolean;
    readonly onList?: () => void;
    readonly onSign?: () => void;
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
  const handler = createMessageHandler(
    createWallet({
      accounts: [SIGNER],
      activeAccountId: () => SIGNER.id,
      ...(options.onSign ? { captureSign: options.onSign } : {}),
    }),
    testExtension,
    {
      multisigGrants: memoryMultisigGrantStore(),
      multisigStore: multisigs,
      preferencesStore: preferences,
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
  return { handler, multisigs, preferences, record, session };
};

describe("multisig dapp accounts", () => {
  test("a single-signer grant is unchanged when no multisig is selected", async () => {
    const session = createUnlockSession();
    session.unlock(vaultPassphrase);
    const handler = createMessageHandler(createWallet(), testExtension, { session });
    await expect(
      handler({ origin: grantedOrigin, type: "wallet.getGrantedAccounts" }, contentSender),
    ).resolves.toEqual({ accounts: [account], ok: true });
    await expect(
      handler({ origin: grantedOrigin, type: "wallet.getPermissions" }, contentSender),
    ).resolves.toEqual({ ok: true, permissions: ["accounts"] });
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

  test("a multisig-only connection is visible to wallet_getPermissions", async () => {
    const { handler, record } = await harness(1);
    const origin = "https://only-multisig.example";
    const sender = { id: "extension-id", url: `${origin}/app` };
    await expect(handler({ origin, type: "wallet.getPermissions" }, sender)).resolves.toEqual({
      ok: true,
      permissions: [],
    });
    const held = handler({ origin, type: "wallet.requestAccounts" }, sender);
    const id = await latestApprovalId(handler, extensionSender);
    await handler(
      { id, reviewedAccountId: record.id, type: "wallet.approveOrigin" },
      extensionSender,
    );
    await held;
    await expect(handler({ origin, type: "wallet.getPermissions" }, sender)).resolves.toEqual({
      ok: true,
      permissions: ["accounts"],
    });
  });

  test("a lock after the grant read does not queue the multisig invoke", async () => {
    let lists = 0;
    let lock = (): void => undefined;
    const { handler, record, session } = await harness(1, {
      onList: () => lock(),
    });
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
    lock = () => {
      lists += 1;
      if (lists >= 2) session.lock();
    };
    await expect(
      handler(
        { calls: invokeCalls, origin: grantedOrigin, type: "wallet.addInvokeTransaction" },
        contentSender,
      ),
    ).resolves.toEqual({ error: "wallet locked" });
    await expect(handler({ type: "wallet.pendingApprovals" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
  });

  test("a saved proposal is refused when its frozen fee exceeds the reviewed ceiling", async () => {
    let signed = false;
    const { handler, multisigs, record } = await harness(2, {
      fee: "1",
      member: true,
      onSign: () => {
        signed = true;
      },
    });
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
    await expect(held).resolves.toEqual({
      error:
        "The network fee for this transaction rose above the amount you reviewed. Nothing was submitted — review it again.",
    });
    expect(signed).toBe(false);
    expect(await multisigs.listIntents()).toHaveLength(0);
  });

  test("a saved proposal is refused when the live class is no longer the pinned account", async () => {
    let signed = false;
    const { handler, multisigs, record } = await harness(2, {
      classHash: "0x1",
      member: true,
      onSign: () => {
        signed = true;
      },
    });
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
    await expect(held).resolves.toEqual({ error: "This multisig isn't the pinned account." });
    expect(signed).toBe(false);
    expect(await multisigs.listIntents()).toHaveLength(0);
  });
});
