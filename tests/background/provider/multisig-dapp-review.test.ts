/**
 * Follow-up checks for a connected multisig: live signer authority, dapp
 * operations that have no multisig lane, a submitted hash that survives a
 * failed local journal, and an OutsideExecution recorded for Activity.
 */
import { describe, expect, test } from "bun:test";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { memoryAllowanceStore } from "@bramble/transactions/allowance-store";
import { memoryRelaySignatureLog } from "@bramble/transactions/relay-signatures";
import { constants, outsideExecution } from "starknet";
import { MULTISIG_REQUEST_UNAVAILABLE } from "../../../apps/extension/src/background/provider/dapp-account";
import { executeDeclareApproval } from "../../../apps/extension/src/background/transactions/declare-ops";
import {
  contentSender,
  createWallet,
  extensionSender,
  grantedOrigin,
} from "../../support/background-wallet-stub";
import { latestApprovalId, reviewedApprovalFee } from "../../support/held";
import { failingInvokeActivityLog } from "../../support/invoke-approval-harness";
import { makeRuntimeRpc } from "../../support/runtime-rpc-stub";
import { harness, typedData } from "./multisig-dapp-harness";

const SIGNER_ID = "SN_MAIN:0x99";
const declare = {
  classHash: "0x5abc",
  compiledClassHash: "0x6def",
  contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
};

const connect = async (
  handler: Awaited<ReturnType<typeof harness>>["handler"],
  accountId: string,
  sender: typeof contentSender = contentSender,
) => {
  const held = handler({ origin: grantedOrigin, type: "wallet.requestAccounts" }, sender);
  const id = await latestApprovalId(handler, extensionSender);
  await handler(
    { id, reviewedAccountId: accountId, type: "wallet.approveOrigin" },
    extensionSender,
  );
  await held;
};

const outside = () =>
  JSON.parse(
    JSON.stringify(
      outsideExecution.getTypedData(
        constants.StarknetChainId.SN_MAIN,
        {
          caller: constants.OutsideExecutionCallerAny,
          execute_after: 1,
          execute_before: 1_900_000_000,
        },
        "0x2a",
        [{ calldata: ["0x5", "0x1", "0x0"], contractAddress: "0x2", entrypoint: "transfer" }],
        "2",
      ),
    ),
  );

describe("multisig dapp review checks", () => {
  test("a changed on-chain signer set is not signed", async () => {
    let signed = false;
    const { handler, record } = await harness(1, {
      onSign: () => {
        signed = true;
      },
      signerConfig: { classHash: "0x1", signerGuids: ["0x1"], threshold: 2 },
    });
    await connect(handler, record.id);
    const held = handler(
      { origin: grantedOrigin, type: "wallet.signTypedData", typedData },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({
      error: "This multisig changed since this request was reviewed.",
    });
    expect(signed).toBe(false);
  });

  test("a signer read that fails does not return a signature", async () => {
    let signed = false;
    const { handler, record } = await harness(1, {
      onSign: () => {
        signed = true;
      },
      signerConfig: "throw",
    });
    await connect(handler, record.id);
    const held = handler(
      { origin: grantedOrigin, type: "wallet.signTypedData", typedData },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({
      error: "This multisig's signers aren't available yet.",
    });
    expect(signed).toBe(false);
  });

  test("declare and deployment data stay on the presented multisig", async () => {
    const { grants, handler, multisigs, preferences, record, session } = await harness(1, {
      grantAccountIds: [SIGNER_ID],
    });
    await connect(handler, record.id);
    await expect(
      handler(
        { declare, origin: grantedOrigin, type: "wallet.addDeclareTransaction" },
        contentSender,
      ),
    ).resolves.toEqual({ error: MULTISIG_REQUEST_UNAVAILABLE });
    await expect(handler({ type: "wallet.pendingApprovals" }, extensionSender)).resolves.toEqual({
      ok: true,
      pending: [],
    });
    const deployment = await handler(
      { origin: grantedOrigin, type: "wallet.deploymentData" },
      contentSender,
    );
    expect(deployment).toEqual({ error: MULTISIG_REQUEST_UNAVAILABLE });
    expect(JSON.stringify(deployment)).not.toContain("0x99");

    const executed = await executeDeclareApproval(
      {
        activity: memoryActivityLog(),
        multisigGrants: grants,
        multisigStore: multisigs,
        preferencesStore: preferences,
        runtimeRpc: makeRuntimeRpc({
          async submitDeclareTransaction() {
            throw new Error("declare submitted");
          },
        }),
        session,
        wallet: createWallet({
          accounts: [
            {
              accountContractType: "openzeppelin",
              address: "0x99",
              classHash: "0x1",
              derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
              id: SIGNER_ID,
              networkId: "SN_MAIN",
              publicKeyX: "0xabc",
              publicKeyY: "0xdef",
            },
          ],
          activeAccountId: () => SIGNER_ID,
          grantAccountIds: [SIGNER_ID],
        }),
      },
      {
        declare,
        origin: grantedOrigin,
        reviewedFee: { overallFee: "1", unit: "FRI" },
      },
    );
    expect(executed).toEqual({ error: MULTISIG_REQUEST_UNAVAILABLE });
  });

  test("a submitted multisig transaction stays successful when the journal rejects", async () => {
    const store = memoryAllowanceStore();
    const { handler, record } = await harness(1, {
      activity: failingInvokeActivityLog(),
      allowanceStore: {
        ...store,
        applyDelta: () => Promise.reject(new Error("quota")),
        record: () => Promise.reject(new Error("quota")),
      },
    });
    await connect(handler, record.id);
    const held = handler(
      {
        calls: [{ calldata: ["0x3", "0x1", "0x0"], contractAddress: "0x2", entrypoint: "approve" }],
        origin: grantedOrigin,
        type: "wallet.addInvokeTransaction",
      },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    const reviewedFee = await reviewedApprovalFee(handler, extensionSender, id);
    await handler({ id, reviewedFee, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toEqual({ ok: true, transactionHash: "0x7cd" });
  });

  test("an OutsideExecution signed by a multisig is recorded for Activity", async () => {
    const relay = memoryRelaySignatureLog(() => 7_000);
    const { handler, record } = await harness(1, { relaySignatures: relay });
    await connect(handler, record.id);
    const plain = handler(
      { origin: grantedOrigin, type: "wallet.signTypedData", typedData },
      contentSender,
    );
    const plainId = await latestApprovalId(handler, extensionSender);
    await handler({ id: plainId, type: "wallet.approveOrigin" }, extensionSender);
    await expect(plain).resolves.toMatchObject({ ok: true });
    expect(await relay.list({ accountId: record.id, networkId: "SN_MAIN" })).toEqual([]);

    const held = handler(
      { origin: grantedOrigin, type: "wallet.signTypedData", typedData: outside() },
      contentSender,
    );
    const id = await latestApprovalId(handler, extensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, extensionSender);
    await expect(held).resolves.toMatchObject({ ok: true });
    await Promise.resolve();
    expect(await relay.list({ accountId: record.id, networkId: "SN_MAIN" })).toEqual([
      expect.objectContaining({
        accountId: record.id,
        callCount: 1,
        checkable: false,
        nonce: "0x2a",
        origin: grantedOrigin,
        status: "signed",
      }),
    ]);
  });
});
