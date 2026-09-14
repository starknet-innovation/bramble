/** MCW-V091-001: accepted hashes survive every best-effort local journal. */

import { describe, expect, test } from "bun:test";
import type { ActivityLog } from "@mc-wallet/transactions/activity";
import { recordSubmittedActivity } from "../../apps/extension/src/background/transactions/activity-recording";
import { latestApprovalId, reviewedApprovalFee } from "../support/held";
import {
  failingInvokeActivityLog,
  invokeContentSender,
  invokeExtensionSender,
  invokeMessage,
  makeInvokeHarness,
} from "../support/invoke-approval-harness";

const SUBMITTERS = [
  "apps/extension/src/background/accounts/deployment-ops.ts",
  "apps/extension/src/background/accounts/wallet-ops.ts",
  "apps/extension/src/background/portfolio/allowance-ops.ts",
  "apps/extension/src/background/portfolio/nft-ops.ts",
  "apps/extension/src/background/privacy/strk20-approval-execution.ts",
  "apps/extension/src/background/privacy/strk20-wallet-ops.ts",
  "apps/extension/src/background/provider/invoke-execution.ts",
  "apps/extension/src/background/transactions/swap-ops.ts",
] as const;

describe("post-broadcast outcome integrity", () => {
  test("a failed activity write cannot reject an accepted hash", async () => {
    const activity = {
      async record() {
        throw new Error("quota exceeded");
      },
    } as unknown as ActivityLog;

    await expect(
      recordSubmittedActivity(activity, {
        accountId: "SN_MAIN:0x1",
        hash: "0x7cd",
        kind: "invoke",
        networkId: "SN_MAIN",
        summary: "Submitted call",
      }),
    ).resolves.toBeUndefined();
  });

  test("a dapp receives the accepted hash when its activity write fails", async () => {
    const { handler, invoked } = makeInvokeHarness(
      undefined,
      undefined,
      {},
      failingInvokeActivityLog(),
    );
    const held = handler(invokeMessage(), invokeContentSender);
    const id = await latestApprovalId(handler, invokeExtensionSender);
    const reviewedFee = await reviewedApprovalFee(handler, invokeExtensionSender, id);
    await expect(
      handler({ id, reviewedFee, type: "wallet.approveOrigin" }, invokeExtensionSender),
    ).resolves.toMatchObject({ ok: true });
    await expect(held).resolves.toEqual({ ok: true, transactionHash: "0x7cd" });
    expect(invoked).toHaveLength(1);
  });

  test("every audited submitter uses the shared post-broadcast boundary", async () => {
    for (const path of SUBMITTERS) {
      const source = await Bun.file(path).text();
      expect(source, path).toContain("recordSubmittedActivity");
    }
  });

  test("privacy maturity bookkeeping preserves a returned broadcast", async () => {
    const source = await Bun.file(
      "packages/features/privacy/src/sdk/official-sdk-maturity.ts",
    ).text();
    expect(source).toContain(
      "await recordSubmission(provider, scope, result.transactionHash).catch(() => undefined)",
    );
  });
});
