/**
 * MCW-V09-120: an approved dapp declare must be journalled BY THE PRODUCTION
 * PATH, not merely by an executor handed a log it built itself.
 *
 * The first attempt at this fix made `activity` optional on DeclareExecuteDeps
 * and recorded through `deps.activity?.record(...)`. The one real caller —
 * `applyDeclare` in approval-decisions.ts — never passed it, so the optional
 * chain was a permanent no-op in production while an executor-level test that
 * supplied its own log passed. This suite therefore drives the whole shipped
 * route: `createMessageHandler` with a real ActivityLog on the context, a dapp
 * `wallet.addDeclareTransaction` from a connected origin, then the user's
 * `wallet.approveOrigin` from the extension page. It fails against a tree where
 * the applier drops the log, whatever the executor's own signature allows.
 */
import { describe, expect, test } from "bun:test";
import type { RuntimeRpc } from "../../src/background/runtime-rpc";
import { latestApprovalId } from "../support/held";
import {
  invokeAccount,
  invokeContentSender,
  invokeExtensionSender,
  invokeOrigin,
  makeInvokeHarness,
} from "../support/invoke-approval-harness";

const declare = {
  classHash: "0x5abc",
  compiledClassHash: "0x6def",
  contractClass: { entry_points_by_type: { EXTERNAL: [] }, sierra_program: ["0x1"] },
};

const declareHarness = () => {
  const submitted: Parameters<RuntimeRpc["submitDeclareTransaction"]>[0][] = [];
  const harness = makeInvokeHarness([invokeAccount], undefined, {
    async submitDeclareTransaction(input: Parameters<RuntimeRpc["submitDeclareTransaction"]>[0]) {
      submitted.push(input);
      return { classHash: "0x7ce", transactionHash: "0x7cd" };
    },
  });
  return { ...harness, submitted };
};

describe("approved dapp declare activity (MCW-V09-120)", () => {
  test("records the submitted declare through createMessageHandler + approveOrigin", async () => {
    const { activity, handler, submitted } = declareHarness();

    // Held: the dapp promise settles only once the user approves.
    const held = handler(
      { declare, origin: invokeOrigin, type: "wallet.addDeclareTransaction" },
      invokeContentSender,
    );
    const id = await latestApprovalId(handler, invokeExtensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, invokeExtensionSender);

    await expect(held).resolves.toEqual({
      classHash: "0x7ce",
      ok: true,
      transactionHash: "0x7cd",
    });
    expect(submitted).toHaveLength(1);
    // The property the finding is about: the transaction is on chain AND the
    // local journal has it. Before the applier wired the log this list was [].
    const entries = await activity.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      accountId: invokeAccount.id,
      hash: "0x7cd",
      kind: "declare",
      networkId: "SN_MAIN",
      status: "pending",
      summary: "Declare contract class 0x5abc",
    });
  });

  test("records nothing when the approved declare is never submitted", async () => {
    // Same production route, but the node refuses the declare: the dapp gets the
    // failure and the journal must stay empty rather than claiming a submission.
    const { activity, handler } = makeInvokeHarness([invokeAccount], undefined, {
      async submitDeclareTransaction(): Promise<never> {
        throw new Error("Class already declared");
      },
    });

    const held = handler(
      { declare, origin: invokeOrigin, type: "wallet.addDeclareTransaction" },
      invokeContentSender,
    );
    const id = await latestApprovalId(handler, invokeExtensionSender);
    await handler({ id, type: "wallet.approveOrigin" }, invokeExtensionSender);

    await expect(held).resolves.toEqual({
      error: "This contract class is already declared on the selected network.",
    });
    expect(await activity.list()).toEqual([]);
  });
});
