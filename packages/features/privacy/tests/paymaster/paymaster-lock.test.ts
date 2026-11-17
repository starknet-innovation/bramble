/**
 * A lock refuses a relayed private broadcast (Sherlock #175).
 *
 * The relay route's only other session checks run while the SDK builds the
 * proof invocation, minutes before the broadcast. The paymaster client is the
 * last point before `paymaster_executeTransaction`, so it re-reads the unlock
 * guard there, after any typed-data signature, exactly as the public lane
 * checks it before `execute`.
 */
import { describe, expect, test } from "bun:test";
import { submitStrk20PaymasterPlan } from "@bramble/privacy/paymaster";
import {
  paymasterCall as call,
  paymasterConfig as config,
  paymasterTypedData as outsideTypedData,
  paymasterResponse as response,
} from "../support/paymaster";

const feeAction = { amount: "0x5", recipient: "0x4", token: "0x3", type: "withdraw" } as const;
const proof = { data: "proof", output: ["0x1"], proof_facts: ["0x2"] };

const recordingHttp =
  (methods: string[]) => async (_url: RequestInfo | URL, init?: RequestInit) => {
    methods.push(String((JSON.parse(String(init?.body)) as { method?: unknown }).method));
    return response({ transaction_hash: "0x123" });
  };

describe("STRK20 paymaster broadcast honours the unlock session", () => {
  test("a locked session refuses a plain apply_action before contacting the relay", async () => {
    const methods: string[] = [];
    await expect(
      submitStrk20PaymasterPlan({
        accountAddress: "0x1",
        call,
        config,
        http: recordingHttp(methods),
        isAuthorized: () => false,
        nowSeconds: 2,
        plan: { feeAction },
        proof,
        signTypedData: async () => {
          throw new Error("no public approval signature expected");
        },
      }),
    ).rejects.toThrow("wallet locked");
    expect(methods).toEqual([]);
  });

  test("a lock during typed-data signing refuses the broadcast", async () => {
    const methods: string[] = [];
    let authorized = true;
    await expect(
      submitStrk20PaymasterPlan({
        accountAddress: "0x1",
        call,
        config,
        http: recordingHttp(methods),
        isAuthorized: () => authorized,
        nowSeconds: 2,
        plan: {
          authorization: {
            caller: "0x99",
            executeAfter: "0x1",
            executeBefore: "0x100",
            publicCallCount: 1,
          },
          feeAction,
          typedData: outsideTypedData(),
        },
        proof,
        signTypedData: async () => {
          // The signer's own RPC reads leave a window; the user locks inside it.
          authorized = false;
          return ["0x6", "0x7"];
        },
      }),
    ).rejects.toThrow("wallet locked");
    expect(methods).toEqual([]);
  });

  test("an unlocked session still relays", async () => {
    const methods: string[] = [];
    await expect(
      submitStrk20PaymasterPlan({
        accountAddress: "0x1",
        call,
        config,
        http: recordingHttp(methods),
        isAuthorized: () => true,
        nowSeconds: 2,
        plan: { feeAction },
        proof,
        signTypedData: async () => {
          throw new Error("no public approval signature expected");
        },
      }),
    ).resolves.toEqual({ transactionHash: "0x123" });
    expect(methods).toEqual(["paymaster_executeTransaction"]);
  });
});
