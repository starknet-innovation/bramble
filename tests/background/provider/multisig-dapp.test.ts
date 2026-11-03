/**
 * A selected Argent multisig can be granted to a site, sign a one-signer
 * login, and save a higher-threshold transaction as an intent. Single-signer
 * grants stay on the vault path.
 */
import { describe, expect, test } from "bun:test";
import { MULTISIG_PROPOSAL_SAVED } from "../../../apps/extension/src/background/provider/multisig-dapp-invoke";
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
import { harness, invokeCalls, multisig, typedData } from "./multisig-dapp-harness";

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

  test("a proposal is not submitted when the threshold drops before approval", async () => {
    let signed = false;
    const { handler, multisigs, record } = await harness(2, {
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
    const next = multisig(1).currentConfig;
    if (!record.currentConfig || !next) throw new Error("missing multisig config");
    expect(await multisigs.updateCurrentConfig(record.id, record.currentConfig, next)).toBe(
      "stored",
    );
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);
    await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({
      error: "This multisig changed since this request was reviewed.",
    });
    expect(signed).toBe(false);
    expect(await multisigs.listIntents()).toHaveLength(0);
  });

  test("a revoked multisig grant stops an invoke that was already reviewed", async () => {
    let armed = false;
    let reads = 0;
    let revoke: (origin: string) => Promise<void> = async () => undefined;
    const { grants, handler, record } = await harness(1, {
      onGrantRead: async () => {
        if (!armed) return;
        reads += 1;
        if (reads === 1) await revoke(grantedOrigin);
      },
    });
    revoke = (origin) => grants.revoke(origin, vaultPassphrase);
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
    armed = true;
    await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "origin not connected" });
  });

  test("a multisig-only connection can ask to switch chain, until the grant is revoked", async () => {
    const { grants, handler, record } = await harness(1);
    const origin = "https://only-multisig.example";
    const sender = { id: "extension-id", url: `${origin}/app` };
    const connect = handler({ origin, type: "wallet.requestAccounts" }, sender);
    const connectId = await latestApprovalId(handler, extensionSender);
    await handler(
      { id: connectId, reviewedAccountId: record.id, type: "wallet.approveOrigin" },
      extensionSender,
    );
    await connect;
    const held = handler(
      { chainId: "0x534e5f5345504f4c4941", origin, type: "wallet.switchChain" },
      sender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    await grants.revoke(origin, vaultPassphrase);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ error: "origin not connected" });
  });
});
