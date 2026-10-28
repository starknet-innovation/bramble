/**
 * A STRK20 batch the SDK or pool is known to reject is refused at the dapp
 * request, before any approval is queued or any quote is read (#443, PR 3),
 * and the site receives INVALID_REQUEST_PAYLOAD (114) naming the rule.
 */
import { describe, expect, test } from "bun:test";
import { toProviderPayload } from "@bramble/wallet-protocol/bridge";
import {
  STRK20_BATCH_REFUSAL_PREFIX,
  STRK20_BATCH_REFUSALS,
  STRK20_SHADOW_ACCOUNT_REFUSAL_PREFIX,
  STRK20_SHADOW_NONCE_UNLISTABLE,
} from "@bramble/wallet-protocol/strk20-batch";
import { flushHeld, waitForPendingApprovals } from "../../support/held";
import {
  buildStrk20Handler,
  STRK20_CONTENT_SENDER,
  STRK20_EXTENSION_SENDER,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const shadow = (entry_point: string, nonce = "0x1") => ({
  calls: [{ calldata: [], contract_address: STRK20_RECIPIENT, entry_point }],
  collect_policy: { type: "all" },
  dapp_name: "Example",
  nonce,
  type: "shadow_account_invoke",
});
const open = { amount: "OPEN", recipient: STRK20_RECIPIENT, token: STRK20_TOKEN, type: "transfer" };
const invoke = { calldata: ["0x1"], contract: STRK20_TOKEN, type: "invoke" };

const CASES = [
  { actions: [shadow("0x1234")], rule: "entryPointSelector" },
  { actions: [invoke, invoke], rule: "multipleInvokes" },
  { actions: [open], rule: "openWithoutInvoke" },
  { actions: [invoke, open], rule: "openAfterInvoke" },
  { actions: [open, open, shadow("swap")], rule: "openPerToken" },
  {
    actions: [{ amount: "0x0a", token: STRK20_TOKEN, type: "deposit" }, open, shadow("swap")],
    rule: "multipleScreeningSubjects",
  },
  { actions: [shadow("swap", "0xffffffffffffffff")], rule: "unlistableNonce" },
] as const;

const REQUESTS = [
  { method: "wallet_strk20PrepareInvoke", type: "wallet.strk20PrepareInvoke" },
  { method: "wallet_strk20InvokeTransaction", type: "wallet.strk20InvokeTransaction" },
] as const;

describe("strk20 batch refusals at the dapp request", () => {
  for (const request of REQUESTS) {
    for (const { actions, rule } of CASES) {
      test(`${request.method} refuses ${rule} before approval`, async () => {
        const proveCalls = { value: 0 };
        const handler = buildStrk20Handler({ proveCalls });
        const result = await handler(
          {
            actions,
            origin: STRK20_ORIGIN,
            ...(request.type === "wallet.strk20PrepareInvoke" ? { simulate: false } : {}),
            type: request.type,
          },
          STRK20_CONTENT_SENDER,
        );
        await flushHeld();
        const pending = (await handler(
          { type: "wallet.pendingApprovals" },
          STRK20_EXTENSION_SENDER,
        )) as {
          readonly pending: readonly unknown[];
        };

        expect(result).toEqual({
          error: `${STRK20_BATCH_REFUSAL_PREFIX}${STRK20_BATCH_REFUSALS[rule]}`,
        });
        expect(pending.pending).toEqual([]);
        expect(proveCalls.value).toBe(0);
        expect(toProviderPayload(result, request.method).error).toEqual({
          code: 114,
          data: STRK20_BATCH_REFUSALS[rule],
          message: "The request payload is invalid",
        });
      });
    }
  }
});

// Shadow F4: a commitment for a nonce the range view cannot list names an
// account the wallet could never check or sweep; refused before approval.
describe("shadow-account commitment nonces", () => {
  const commitment = (nonce: string) => ({
    dappName: "Example",
    nonce,
    origin: STRK20_ORIGIN,
    type: "wallet.strk20ShadowAccountCommitment",
  });

  test("2^64 - 1 is refused with the precise protocol error, before any approval", async () => {
    const shadowAccountCalls = { value: 0 };
    const handler = buildStrk20Handler({ shadowAccountCalls });
    const result = await handler(commitment("0xffffffffffffffff"), STRK20_CONTENT_SENDER);
    await flushHeld();
    const pending = (await handler(
      { type: "wallet.pendingApprovals" },
      STRK20_EXTENSION_SENDER,
    )) as { readonly pending: readonly unknown[] };

    expect(result).toEqual({
      error: `${STRK20_SHADOW_ACCOUNT_REFUSAL_PREFIX}${STRK20_SHADOW_NONCE_UNLISTABLE}`,
    });
    expect(pending.pending).toEqual([]);
    expect(shadowAccountCalls.value).toBe(0);
    expect(toProviderPayload(result, "wallet_strk20ShadowAccountCommitment").error).toEqual({
      code: 114,
      data: STRK20_SHADOW_NONCE_UNLISTABLE,
      message: "The request payload is invalid",
    });
  });

  test("the last listable nonce still reaches its approval", async () => {
    const handler = buildStrk20Handler();
    void handler(commitment("0xfffffffffffffffe"), STRK20_CONTENT_SENDER);
    expect(await waitForPendingApprovals(handler, STRK20_EXTENSION_SENDER)).toHaveLength(1);
  });
});
