/** MCW-V091-001: accepted hashes survive every best-effort local journal. */

import { describe, expect, test } from "bun:test";
import type { ActivityLog } from "@bramble/transactions/activity";
import {
  afterBroadcast,
  recordSubmittedActivity,
} from "../../apps/extension/src/background/transactions/activity-recording";
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
  "apps/extension/src/background/portfolio/nft-transfer-submit.ts",
  "apps/extension/src/background/privacy/strk20-approval-execution.ts",
  "apps/extension/src/background/privacy/strk20-wallet-execution.ts",
  "apps/extension/src/background/provider/provider-ops.ts",
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

  test("bookkeeping that throws after a broadcast cannot replace the reply", async () => {
    let ran = false;
    await expect(
      afterBroadcast(async () => {
        ran = true;
        throw new Error("vault storage limit reached");
      }),
    ).resolves.toBeUndefined();
    expect(ran).toBe(true);
  });

  // Errors audit F1/F2: once a hash exists the reply is success or status
  // unknown. The public send, the NFT send, the swap, and every pool route run all of their
  // post-hash bookkeeping (not just the writes) through the boundary, for the
  // accepted hash and for the signed hash of a lost reply alike.
  test("the send, swap, and pool executors keep every post-hash step behind the boundary", async () => {
    const expectations: Readonly<Record<string, readonly string[]>> = {
      "apps/extension/src/background/accounts/wallet-ops.ts": [
        "await afterBroadcast(() => recordSubmittedActivity(deps.activity, activityFor(pending)));",
        "await afterBroadcast(() => recordSubmittedActivity(deps.activity, activityFor(transactionHash)));",
      ],
      "apps/extension/src/background/privacy/strk20-wallet-execution.ts": [
        "await afterBroadcast(async () => {\n    // Entering the pool",
      ],
      "apps/extension/src/background/portfolio/nft-transfer-submit.ts": [
        "await afterBroadcast(() => recordSubmittedActivity(deps.activity, activityFor(pending)));",
        "await afterBroadcast(async () => {\n    await recordSubmittedActivity(deps.activity, activityFor(transactionHash));",
      ],
      "apps/extension/src/background/transactions/swap-ops.ts": [
        "await afterBroadcast(() => recordSubmitted(pending));",
        "await afterBroadcast(() => recordSubmitted(transactionHash));",
      ],
    };
    for (const [path, snippets] of Object.entries(expectations)) {
      const source = await Bun.file(path).text();
      for (const snippet of snippets) expect(source, path).toContain(snippet);
    }
  });

  test("privacy maturity bookkeeping preserves a returned broadcast", async () => {
    const source = await Bun.file(
      "packages/features/privacy/src/sdk/official-sdk-maturity.ts",
    ).text();
    // The proof's base block rides along (mc-wallet 661); the swallow is the pin.
    expect(source).toMatch(
      /await recordSubmission\(provider, scope, result\.transactionHash, proofBaseBlock\)\.catch\(\s*\(\) => undefined,?\s*\)/,
    );
  });
});
