/**
 * Background STRK20 message checks prove private reads, proof preparation,
 * identity commitments, and invokes stay held until explicit approval.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20Service } from "@bramble/privacy/service";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import type { InvokeInput } from "@bramble/starknet/rpc";
import { memoryActivityLog } from "@bramble/transactions/activity";
import { toProviderPayload } from "@bramble/wallet-protocol/bridge";
import {
  flushHeld,
  latestApprovalId,
  reviewedApprovalFee,
  waitForPendingApprovals,
} from "../../support/held";
import {
  approveHeldStrk20,
  buildStrk20Handler,
  STRK20_CALL_AND_PROOF,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const token = STRK20_TOKEN;
const recipient = STRK20_RECIPIENT;
const origin = STRK20_ORIGIN;
const sender = STRK20_EXTENSION_SENDER;
const contentSender = STRK20_CONTENT_SENDER;
const callAndProof = STRK20_CALL_AND_PROOF;
// The spec's literal `${openNoteIds[0]}` calldata placeholder, assembled by
// interpolation so the source carries no bare "${" template token.
const openNotePlaceholder = `${"$"}{openNoteIds[0]}`;
const buildHandler = buildStrk20Handler;
const approveHeld = approveHeldStrk20;

describe("background strk20 messages", () => {
  test("registers only after an account, network, pool, and token-bound approval", async () => {
    const activity = memoryActivityLog();
    const registerCalls = { value: 0 };
    const proveCalls = { value: 0 };
    const preparedSubmissions: Parameters<Strk20Service["submitPrepared"]>[0][] = [];
    const handler = buildHandler({
      activity,
      preparedSubmissions,
      proveCalls,
      registerCalls,
      registered: false,
    });
    const result = await approveHeld(
      handler,
      { origin, type: "wallet.strk20Register" },
      "strk20-register",
      () => {
        expect(proveCalls.value).toBe(0);
        expect(registerCalls.value).toBe(0);
      },
    );
    expect(result).toEqual({ ok: true, transactionHash: "0x123" });
    expect(registerCalls.value).toBe(1);
    expect(proveCalls.value).toBe(1);
    expect(preparedSubmissions).toHaveLength(1);
    expect(preparedSubmissions[0]?.reviewedFee).toEqual({ overallFee: "1", unit: "FRI" });
    expect(preparedSubmissions[0]?.calls).toHaveLength(1);
    expect((await activity.list())[0]?.summary).toBe("Activate private balances");
    expect(toProviderPayload(result, "mc_strk20Register")).toEqual({
      result: { transaction_hash: `0x${"123".padStart(64, "0")}` },
    });
  });

  test("renders the registration pool fee in STRK, not as a raw felt", async () => {
    const handler = buildHandler({ registered: false });
    const held = handler({ origin, type: "wallet.strk20Register" }, contentSender);
    await flushHeld();
    const listed = await waitForPendingApprovals<{
      readonly id: string;
      readonly kind?: string;
      readonly summaries?: readonly string[];
    }>(handler, sender);
    // The harness's pool fee is 0x1 base units, so its readable form is 1e-18
    // STRK; the point is that the panel reads a STRK amount, never the felt.
    expect(listed.at(-1)).toMatchObject({
      kind: "strk20-register",
      summaries: expect.arrayContaining([
        "Approve and pay the reviewed 0.000000000000000001 STRK pool fee",
      ]),
    });
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    await held;
  });

  test("does not submit registration when the user denies activation", async () => {
    const registerCalls = { value: 0 };
    const handler = buildHandler({ registerCalls, registered: false });
    const held = handler({ origin, type: "wallet.strk20Register" }, contentSender);
    await flushHeld();
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    const result = await held;
    expect(toProviderPayload(result, "mc_strk20Register").error?.code).toBe(113);
    expect(registerCalls.value).toBe(0);
  });

  test("reads private balances only after approval", async () => {
    const balanceCalls = { value: 0 };
    const handler = buildHandler({ balanceCalls });
    const result = await approveHeld(
      handler,
      { origin, tokens: [token], type: "wallet.strk20Balances" },
      "strk20-balances",
      () => expect(balanceCalls.value).toBe(0),
    );
    expect(result).toEqual({ balances: [{ balance: "0x64", token }], ok: true });
    expect(balanceCalls.value).toBe(1);
    expect(toProviderPayload(result, "wallet_strk20Balances")).toEqual({
      result: [{ balance: "0x64", token }],
    });
  });

  test("describes an empty token list as disclosure of every private balance", async () => {
    const handler = buildHandler();
    const held = handler({ origin, tokens: [], type: "wallet.strk20Balances" }, contentSender);
    await flushHeld();
    const listed = await waitForPendingApprovals<{
      readonly id: string;
      readonly kind?: string;
      readonly summaries?: readonly string[];
    }>(handler, sender);
    expect(listed.at(-1)).toMatchObject({
      kind: "strk20-balances",
      summaries: ["Share all private token balances"],
    });
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    await held;
  });

  test("maps an unregistered account to NOT_REGISTERED (118)", async () => {
    const handler = buildHandler({ registered: false });
    const result = await approveHeld(
      handler,
      { origin, tokens: [token], type: "wallet.strk20Balances" },
      "strk20-balances",
    );
    expect(toProviderPayload(result, "wallet_strk20Balances").error?.code).toBe(118);
  });

  test("prepares a call-and-proof envelope only after approval without submitting", async () => {
    const invoked: InvokeInput[] = [];
    const proveCalls = { value: 0 };
    const handler = buildHandler({ invoked, proveCalls });
    const result = await approveHeld(
      handler,
      {
        actions: [{ amount: "0x0a", recipient, token, type: "withdraw" }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      "strk20-prepare",
      () => expect(proveCalls.value).toBe(0),
    );
    expect(result).toEqual({ callAndProof, ok: true });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke")).toEqual({
      result: callAndProof,
    });
    expect(invoked).toHaveLength(0);
    expect(proveCalls.value).toBe(1);
  });

  test("rejects an action exceeding the private balance (119)", async () => {
    const handler = buildHandler({ balance: "0x1" });
    const result = await approveHeld(
      handler,
      {
        actions: [{ amount: "0x3e8", recipient, token, type: "withdraw" }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      "strk20-prepare",
    );
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke").error?.code).toBe(119);
  });

  test("rejects a leaking deposit/withdraw batch (120)", async () => {
    const handler = buildHandler();
    const result = await approveHeld(
      handler,
      {
        actions: [
          { amount: "0x05", token, type: "deposit" },
          { amount: "0x05", recipient, token, type: "withdraw" },
        ],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      "strk20-prepare",
    );
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke").error?.code).toBe(120);
  });

  test("rejects a malformed prepare payload (114)", async () => {
    const handler = buildHandler();
    const result = await handler(
      { actions: [], origin, simulate: false, type: "wallet.strk20PrepareInvoke" },
      contentSender,
    );
    expect(result).toEqual({ error: "invalid strk20 prepare request" });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke").error?.code).toBe(114);
  });

  test("prepares an OPEN transfer plus a placeholder-bearing invoke in simulate mode", async () => {
    const handler = buildHandler();
    const result = await approveHeld(
      handler,
      {
        actions: [
          { amount: "OPEN", recipient, token, type: "transfer" },
          { calldata: ["0x1", openNotePlaceholder], contract: token, type: "invoke" },
        ],
        origin,
        simulate: true,
        type: "wallet.strk20PrepareInvoke",
      },
      "strk20-prepare",
    );
    expect(result).toEqual({ callAndProof, ok: true });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke")).toEqual({
      result: callAndProof,
    });
  });

  test("prepares a numeric transfer within the private balance", async () => {
    const handler = buildHandler();
    const result = await approveHeld(
      handler,
      {
        actions: [{ amount: "0x0a", recipient, token, type: "transfer" }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      "strk20-prepare",
    );
    expect(result).toEqual({ callAndProof, ok: true });
  });

  test("derives a dapp-scoped commitment only after approval", async () => {
    const shadowAccountCalls = { value: 0 };
    const handler = buildHandler({ shadowAccountCalls });
    const result = await approveHeld(
      handler,
      {
        dappName: "Example",
        nonce: "0x1",
        origin,
        type: "wallet.strk20ShadowAccountCommitment",
      },
      "strk20-shadow-account",
      () => expect(shadowAccountCalls.value).toBe(0),
    );
    expect(result).toEqual({ commitment: "0x123", ok: true });
    expect(shadowAccountCalls.value).toBe(1);
  });

  test("rejects the old `action`-discriminated shape at routing (114)", async () => {
    const handler = buildHandler();
    const result = await handler(
      {
        actions: [{ action: "withdraw", amount: "10", token }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
      contentSender,
    );
    expect(result).toEqual({ error: "invalid strk20 prepare request" });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke").error?.code).toBe(114);
  });

  test("holds the invoke until approval, then submits a padded hash", async () => {
    const invoked: InvokeInput[] = [];
    const balanceCalls = { value: 0 };
    const proveCalls = { value: 0 };
    const handler = buildHandler({ balanceCalls, invoked, proveCalls });
    const held = handler(
      {
        actions: [{ amount: "0x0a", recipient, token, type: "withdraw" }],
        origin,
        type: "wallet.strk20InvokeTransaction",
      },
      contentSender,
    );
    await flushHeld();
    const listed = await waitForPendingApprovals<{
      readonly context?: { readonly payloadDigest?: string };
      readonly id: string;
      readonly kind?: string;
      readonly summaries?: readonly string[];
    }>(handler, sender);
    expect(listed.at(-1)).toMatchObject({
      context: { payloadDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
      kind: "strk20-invoke",
      origin,
      summaries: expect.arrayContaining([expect.stringContaining("Private relay fee")]),
    });
    expect(invoked).toHaveLength(0);
    expect(balanceCalls.value).toBe(0);
    expect(proveCalls.value).toBe(0);

    const id = await latestApprovalId(handler, sender);
    await expect(handler({ id, type: "wallet.approveOrigin" }, sender)).resolves.toMatchObject({
      ok: true,
      pending: [],
    });
    const result = await held;
    expect(result).toEqual({ ok: true, transactionHash: "0x123" });
    expect(toProviderPayload(result, "wallet_strk20InvokeTransaction")).toEqual({
      result: { transaction_hash: `0x${"123".padStart(64, "0")}` },
    });
    expect(invoked).toHaveLength(0);
    expect(balanceCalls.value).toBeGreaterThan(0);
    expect(proveCalls.value).toBe(1);
  });

  test("a public deposit proves only after consent, then requires exact-call fee approval", async () => {
    const proveCalls = { value: 0 };
    const preparedSubmissions: Parameters<Strk20Service["submitPrepared"]>[0][] = [];
    const handler = buildHandler({ preparedSubmissions, proveCalls });
    const held = handler(
      {
        actions: [{ amount: "0x0a", token, type: "deposit" }],
        origin,
        type: "wallet.strk20InvokeTransaction",
      },
      contentSender,
    );
    await flushHeld();
    const firstId = await latestApprovalId(handler, sender);
    expect(proveCalls.value).toBe(0);
    await handler({ id: firstId, type: "wallet.approveOrigin" }, sender);

    const invokeId = await latestApprovalId(handler, sender);
    expect(invokeId).not.toBe(firstId);
    expect(proveCalls.value).toBe(1);
    expect(preparedSubmissions).toHaveLength(0);
    const reviewedFee = await reviewedApprovalFee(handler, sender, invokeId);
    await handler({ id: invokeId, reviewedFee, type: "wallet.approveOrigin" }, sender);

    await expect(held).resolves.toEqual({ ok: true, transactionHash: "0x123" });
    expect(preparedSubmissions).toHaveLength(1);
    expect(preparedSubmissions[0]?.reviewedFee).toEqual(reviewedFee);
    expect(preparedSubmissions[0]?.calls).toHaveLength(1);
  });

  test("threads the complete active-network service config into the SDK adapter", async () => {
    const preferences = {
      ...defaultWalletPreferences(),
      activeNetworkId: "SN_SEPOLIA" as const,
      strk20Networks: {
        SN_SEPOLIA: {
          discoveryUrl: "https://discovery.example/strk20",
          poolAddress: token,
          proverUrl: "https://prover.example/strk20",
          subaccountAnonymizerAddress: recipient,
        },
      },
    };
    const seenConfigs: unknown[] = [];
    const strk20: Strk20Service = {
      async prepare() {
        return callAndProof;
      },
      async privateBalances({ config, tokens }) {
        seenConfigs.push(config);
        return tokens.map((entry) => ({ balance: "0x64", token: entry }));
      },
      async quoteActions() {
        return {
          feeAction: { amount: "0x1", recipient, token, type: "withdraw" },
        };
      },
      async shadowAccountCommitment() {
        return "0x123";
      },
      async submitActions() {
        return { transactionHash: "0x123" };
      },
      async submitPrepared() {
        return { transactionHash: "0x123" };
      },
    };
    const handler = buildHandler({ preferences, strk20 });

    await approveHeld(
      handler,
      { origin, tokens: [token], type: "wallet.strk20Balances" },
      "strk20-balances",
    );
    expect(seenConfigs).toEqual([preferences.strk20Networks.SN_SEPOLIA]);
  });

  for (const request of [
    {
      kind: "strk20-balances",
      method: "wallet_strk20Balances",
      payload: { origin, tokens: [token], type: "wallet.strk20Balances" },
    },
    {
      kind: "strk20-prepare",
      method: "wallet_strk20PrepareInvoke",
      payload: {
        actions: [{ amount: "0x0a", recipient, token, type: "withdraw" }],
        origin,
        simulate: false,
        type: "wallet.strk20PrepareInvoke",
      },
    },
    {
      kind: "strk20-shadow-account",
      method: "wallet_strk20ShadowAccountCommitment",
      payload: {
        dappName: "Example",
        origin,
        type: "wallet.strk20ShadowAccountCommitment",
      },
    },
  ] as const) {
    test(`maps a denied ${request.kind} request to USER_REFUSED_OP (113)`, async () => {
      const balanceCalls = { value: 0 };
      const proveCalls = { value: 0 };
      const shadowAccountCalls = { value: 0 };
      const handler = buildHandler({ balanceCalls, proveCalls, shadowAccountCalls });
      const held = handler(request.payload, contentSender);
      await flushHeld();
      const id = await latestApprovalId(handler, sender);
      await handler({ id, type: "wallet.denyOrigin" }, sender);
      const result = await held;
      expect(toProviderPayload(result, request.method).error?.code).toBe(113);
      expect(balanceCalls.value).toBe(0);
      expect(proveCalls.value).toBe(0);
      expect(shadowAccountCalls.value).toBe(0);
    });
  }

  test("maps a denied invoke to USER_REFUSED_OP (113)", async () => {
    const invoked: InvokeInput[] = [];
    const handler = buildHandler({ invoked });
    const held = handler(
      {
        actions: [{ amount: "0x0a", recipient, token, type: "withdraw" }],
        origin,
        type: "wallet.strk20InvokeTransaction",
      },
      contentSender,
    );
    await flushHeld();
    const id = await latestApprovalId(handler, sender);
    await handler({ id, type: "wallet.denyOrigin" }, sender);
    const result = await held;
    expect(toProviderPayload(result, "wallet_strk20InvokeTransaction").error?.code).toBe(113);
    expect(invoked).toHaveLength(0);
  });
});
