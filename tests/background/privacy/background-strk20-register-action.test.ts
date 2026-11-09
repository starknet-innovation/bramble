/**
 * Wallet API 0.10.5 STRK20 register action: a lone `{ type: "register" }` in
 * wallet_strk20InvokeTransaction runs the wallet-submitted registration, in
 * wallet_strk20PrepareInvoke returns the registration call and proof without
 * submitting, and both refuse an already registered account or a register
 * mixed with other actions as INVALID_REQUEST_PAYLOAD (114).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { defaultWalletPreferences } from "@bramble/settings/preferences";
import { toProviderPayload } from "@bramble/wallet-protocol/bridge";
import {
  STRK20_PREPARE_REGISTER_SUMMARY,
  STRK20_SIMULATE_REGISTER_SUMMARY,
} from "@bramble/wallet-protocol/strk20";
import { clearStrk20PoolKeyCache } from "../../../apps/extension/src/background/privacy/strk20-registration-owner";
import { flushHeld, latestApprovalId, waitForPendingApprovals } from "../../support/held";
import {
  approveHeldStrk20,
  buildStrk20Handler,
  STRK20_CALL_AND_PROOF,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const origin = STRK20_ORIGIN;
const register = { type: "register" } as const;

const invokeRegister = { actions: [register], origin, type: "wallet.strk20InvokeTransaction" };
const prepareRegister = (simulate: boolean) => ({
  actions: [register],
  origin,
  simulate,
  type: "wallet.strk20PrepareInvoke",
});

type Listed = {
  readonly id: string;
  readonly kind?: string;
  readonly summaries?: readonly string[];
};

// The pool-key cache is module state: a foreign key cached here would turn
// every later suite in this process into an "other wallet" account.
afterEach(clearStrk20PoolKeyCache);

describe("strk20 register action", () => {
  test("invoke with a lone register action submits registration after both approvals", async () => {
    const registerCalls = { value: 0 };
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ proveCalls, registerCalls, registered: false });
    const result = await approveHeldStrk20(handler, invokeRegister, "strk20-register", () => {
      expect(proveCalls.value).toBe(0);
      expect(registerCalls.value).toBe(0);
    });
    expect(result).toEqual({ ok: true, transactionHash: "0x123" });
    expect(toProviderPayload(result, "wallet_strk20InvokeTransaction")).toEqual({
      result: { transaction_hash: `0x${"123".padStart(64, "0")}` },
    });
  });

  test("prepare with a lone register action returns the call and proof without submitting", async () => {
    const registerCalls = { value: 0 };
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ proveCalls, registerCalls, registered: false });
    const held = handler(prepareRegister(false), STRK20_CONTENT_SENDER);
    await flushHeld();
    const listed = await waitForPendingApprovals<Listed>(handler, STRK20_EXTENSION_SENDER);
    expect(listed.at(-1)).toMatchObject({ kind: "strk20-register" });
    expect(listed.at(-1)?.summaries?.[0]).toBe(STRK20_PREPARE_REGISTER_SUMMARY);
    expect(proveCalls.value).toBe(0);
    const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
    await handler({ id, type: "wallet.approveOrigin" }, STRK20_EXTENSION_SENDER);
    const result = await held;
    expect(result).toEqual({ callAndProof: STRK20_CALL_AND_PROOF, ok: true });
    expect(toProviderPayload(result, "wallet_strk20PrepareInvoke")).toEqual({
      result: STRK20_CALL_AND_PROOF,
    });
    expect(proveCalls.value).toBe(1);
    expect(registerCalls.value).toBe(0);
    // No follow-up fee approval: the site submits the prepared call itself.
    const remaining = await handler({ type: "wallet.pendingApprovals" }, STRK20_EXTENSION_SENDER);
    expect(remaining).toMatchObject({ ok: true });
    expect(JSON.stringify(remaining)).not.toContain('"kind":"invoke"');
  });

  test("simulated prepare register returns an empty proof", async () => {
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ proveCalls, registered: false });
    const held = handler(prepareRegister(true), STRK20_CONTENT_SENDER);
    await flushHeld();
    const listed = await waitForPendingApprovals<Listed>(handler, STRK20_EXTENSION_SENDER);
    expect(listed.at(-1)?.summaries?.[0]).toBe(STRK20_SIMULATE_REGISTER_SUMMARY);
    const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
    await handler({ id, type: "wallet.approveOrigin" }, STRK20_EXTENSION_SENDER);
    expect(await held).toEqual({
      callAndProof: {
        call: STRK20_CALL_AND_PROOF.call,
        proof: { data: "", output: [], proof_facts: [] },
      },
      ok: true,
    });
    expect(proveCalls.value).toBe(0);
  });

  // Approves the single held card and returns the settled result.
  const approveOnly = async (handler: ReturnType<typeof buildStrk20Handler>, message: object) => {
    const held = handler(message, STRK20_CONTENT_SENDER);
    await flushHeld();
    const listed = await waitForPendingApprovals<Listed>(handler, STRK20_EXTENSION_SENDER);
    expect(listed.map((approval) => approval.kind)).toEqual(["strk20-register"]);
    const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
    await handler({ id, type: "wallet.approveOrigin" }, STRK20_EXTENSION_SENDER);
    return held;
  };

  test("prepare register needs no tracked token on the network", async () => {
    const defaults = defaultWalletPreferences();
    const pool = defaults.strk20Networks?.SN_MAIN;
    if (!pool) throw new Error("missing default STRK20 config");
    // A configured pool on the active network, but no tracked token at all.
    const handler = buildStrk20Handler({
      preferences: {
        ...defaults,
        activeNetworkId: "SN_SEPOLIA",
        strk20Networks: { ...defaults.strk20Networks, SN_SEPOLIA: pool },
        tokens: [],
      },
      registered: false,
    });
    expect(await approveOnly(handler, prepareRegister(false))).toEqual({
      callAndProof: STRK20_CALL_AND_PROOF,
      ok: true,
    });
  });

  test("prepare register refuses an undeployed account after approval, before proving", async () => {
    const proveCalls = { value: 0 };
    const handler = buildStrk20Handler({ deployed: false, proveCalls, registered: false });
    expect(await approveOnly(handler, prepareRegister(false))).toEqual({
      error: "Deploy this account before activating private balances",
    });
    expect(proveCalls.value).toBe(0);
  });

  test("holds an already registered account on a notice, then refuses with 114", async () => {
    for (const [message, method] of [
      [invokeRegister, "wallet_strk20InvokeTransaction"],
      [prepareRegister(false), "wallet_strk20PrepareInvoke"],
    ] as const) {
      const handler = buildStrk20Handler({ registered: true });
      const held = handler(message, STRK20_CONTENT_SENDER);
      // Audit L1: setup is never answered at once; no activation card is raised.
      const pending = await waitForPendingApprovals<Listed>(handler, STRK20_EXTENSION_SENDER);
      expect(pending.map((approval) => approval.kind)).toEqual(["strk20-unavailable"]);
      await handler({ id: pending[0]?.id, type: "wallet.denyOrigin" }, STRK20_EXTENSION_SENDER);
      expect(toProviderPayload(await held, method).error?.code).toBe(114);
    }
  });

  test("a key another wallet registered is still refused with 114, on the other-wallet notice", async () => {
    const own = `0x${"1".repeat(63)}`;
    const foreign = `0x${"2".repeat(63)}`;
    for (const [message, method] of [
      [invokeRegister, "wallet_strk20InvokeTransaction"],
      [prepareRegister(false), "wallet_strk20PrepareInvoke"],
    ] as const) {
      const handler = buildStrk20Handler({
        ownViewingPublicKey: own,
        poolPublicKey: foreign,
        registered: false,
      });
      const held = handler(message, STRK20_CONTENT_SENDER);
      const pending = await waitForPendingApprovals<Listed & { readonly notice?: string }>(
        handler,
        STRK20_EXTENSION_SENDER,
      );
      expect(pending.map(({ kind, notice }) => [kind, notice])).toEqual([
        ["strk20-unavailable", "other-wallet"],
      ]);
      await handler({ id: pending[0]?.id, type: "wallet.denyOrigin" }, STRK20_EXTENSION_SENDER);
      expect(toProviderPayload(await held, method).error?.code).toBe(114);
    }
  });

  test("a key another wallet registers while the card is open is refused with 114", async () => {
    const own = `0x${"1".repeat(63)}`;
    const foreign = `0x${"2".repeat(63)}`;
    for (const [message, method] of [
      [invokeRegister, "wallet_strk20InvokeTransaction"],
      [prepareRegister(false), "wallet_strk20PrepareInvoke"],
    ] as const) {
      clearStrk20PoolKeyCache();
      let poolKey = "0x0";
      const handler = buildStrk20Handler({
        ownViewingPublicKey: own,
        poolPublicKey: async () => poolKey,
        registered: false,
      });
      const held = handler(message, STRK20_CONTENT_SENDER);
      const listed = await waitForPendingApprovals<Listed>(handler, STRK20_EXTENSION_SENDER);
      expect(listed.map((approval) => approval.kind)).toEqual(["strk20-register"]);
      // Another wallet registers the account before the user approves.
      poolKey = foreign;
      const id = await latestApprovalId(handler, STRK20_EXTENSION_SENDER);
      await handler({ id, type: "wallet.approveOrigin" }, STRK20_EXTENSION_SENDER);
      expect(toProviderPayload(await held, method).error?.code).toBe(114);
    }
  });

  test("refuses register mixed with other actions or carrying extra keys (114)", async () => {
    const handler = buildStrk20Handler({ registered: false });
    const deposit = { amount: "0x0a", token: STRK20_TOKEN, type: "deposit" };
    for (const actions of [
      [register, deposit],
      [deposit, register],
      [register, register],
      [{ token: STRK20_TOKEN, type: "register" }],
    ]) {
      const invoke = await handler(
        { actions, origin, type: "wallet.strk20InvokeTransaction" },
        STRK20_CONTENT_SENDER,
      );
      expect(toProviderPayload(invoke, "wallet_strk20InvokeTransaction").error?.code).toBe(114);
      const prepare = await handler(
        { actions, origin, simulate: false, type: "wallet.strk20PrepareInvoke" },
        STRK20_CONTENT_SENDER,
      );
      expect(toProviderPayload(prepare, "wallet_strk20PrepareInvoke").error?.code).toBe(114);
    }
  });
});
