/**
 * The hard state-change invariant: every state-changing spec method HOLDS and
 * mutates nothing until `wallet.approveOrigin`. Driven end-to-end through the
 * REAL background message handler with instrumented mocks: after firing the
 * request the mutation spy is untouched and an approval is queued; approve
 * performs exactly one mutation and resolves the held request; deny performs no
 * mutation and reaches the dapp as USER_REFUSED_OP (113).
 */
import { describe, expect, test } from "bun:test";
import type { ProviderMethod, RuntimeMessage } from "@mc-wallet/wallet-protocol/bridge";
import { toProviderPayload } from "@mc-wallet/wallet-protocol/bridge";
import type { RuntimeSender } from "../../apps/extension/src/background/routing/senders";
import {
  flushHeld,
  latestApprovalId,
  reviewedApprovalFee,
  waitForPendingApprovals,
} from "../support/held";
import {
  buildHarness,
  CONNECT_ORIGIN,
  CONNECT_SENDER,
  CONTENT_SENDER,
  EXTENSION_SENDER,
  type MutationSpy,
  totalMutations,
} from "./harness";
import { ERROR_CODES, SPEC_METHODS, type SpecMethod } from "./wallet-rpc-spec";

// The single mutation each state-changing method performs on approval.
const SPY_KEY: Readonly<Record<string, keyof MutationSpy>> = {
  wallet_addDeclareTransaction: "submitDeclare",
  wallet_addInvokeTransaction: "submitInvoke",
  wallet_addStarknetChain: "addCustomNetwork",
  wallet_requestAccounts: "grantOrigin",
  wallet_signTypedData: "signHash",
  wallet_strk20InvokeTransaction: "submitInvoke",
  wallet_switchStarknetChain: "setActiveNetwork",
  wallet_watchAsset: "upsertToken",
};

const spyKeyFor = (method: ProviderMethod): keyof MutationSpy => {
  const key = SPY_KEY[method];
  if (!key) {
    throw new Error(`no mutation spy mapped for ${method}`);
  }
  return key;
};

// The runtime message + sender the content bridge would deliver. Connect drives
// an unconnected origin so it queues rather than resolving from an existing
// grant; every other method uses the already-granted ORIGIN.
const driveFor = (
  entry: SpecMethod,
): { readonly message: RuntimeMessage; readonly sender: RuntimeSender } =>
  entry.method === "wallet_requestAccounts"
    ? {
        message: { origin: CONNECT_ORIGIN, type: "wallet.requestAccounts" },
        sender: CONNECT_SENDER,
      }
    : { message: entry.expectedRuntime, sender: CONTENT_SENDER };

const stateChanging: readonly SpecMethod[] = SPEC_METHODS.filter((entry) => entry.stateChanging);

describe("state-change hold invariant", () => {
  for (const entry of stateChanging) {
    const spyKey = spyKeyFor(entry.method);

    describe(entry.method, () => {
      test("holds and mutates nothing until approval, then mutates exactly once", async () => {
        const { handler, spy } = buildHarness();
        const { message, sender } = driveFor(entry);

        const held = handler(message, sender);
        await flushHeld();

        // Nothing has changed and the request is parked as an approval.
        expect(totalMutations(spy)).toBe(0);
        expect(await waitForPendingApprovals(handler, EXTENSION_SENDER)).toHaveLength(1);

        const id = await latestApprovalId(handler, EXTENSION_SENDER);
        const reviewedFee =
          entry.method === "wallet_addInvokeTransaction"
            ? await reviewedApprovalFee(handler, EXTENSION_SENDER, id)
            : undefined;
        await handler(
          { id, ...(reviewedFee ? { reviewedFee } : {}), type: "wallet.approveOrigin" },
          EXTENSION_SENDER,
        );

        const result = (await held) as Record<string, unknown>;
        expect("error" in result).toBe(false);
        // Exactly the one expected mutation happened, and only on approval.
        expect(spy[spyKey]).toBe(1);
        expect(totalMutations(spy)).toBe(1);
      });

      test("a deny mutates nothing and reaches the dapp as USER_REFUSED_OP (113)", async () => {
        const { handler, spy } = buildHarness();
        const { message, sender } = driveFor(entry);

        const held = handler(message, sender);
        await flushHeld();
        expect(totalMutations(spy)).toBe(0);

        const id = await latestApprovalId(handler, EXTENSION_SENDER);
        await handler({ id, type: "wallet.denyOrigin" }, EXTENSION_SENDER);

        const result = await held;
        expect(toProviderPayload(result, entry.resultMethod).error?.code).toBe(
          ERROR_CODES.USER_REFUSED_OP,
        );
        // The refused operation left wallet state completely untouched.
        expect(totalMutations(spy)).toBe(0);
      });
    });
  }

  test("covers every state-changing spec method", () => {
    expect(stateChanging.map((entry) => entry.method).sort()).toEqual(
      Object.keys(SPY_KEY).sort() as ProviderMethod[],
    );
  });
});
