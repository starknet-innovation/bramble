/** Adversarial relay-quote checks for fee theft and public-account linkage. */
import { describe, expect, test } from "bun:test";
import { buildStrk20PaymasterPlan } from "@bramble/privacy/paymaster";
import { type Call, OutsideExecutionVersion, outsideExecution } from "starknet";

const config = { feeToken: "0x3", url: "https://paymaster.example" };
const response = (result: unknown): Response =>
  new Response(JSON.stringify({ id: "bramble-strk20", jsonrpc: "2.0", result }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });

const quote = (
  overrides: {
    readonly amount?: string;
    readonly recipient?: string;
    readonly typedData?: unknown;
  } = {},
): Record<string, unknown> => ({
  fee: {
    estimated_fee_in_strk: "0x8",
    gas_token_price_in_strk: "0x1",
    suggested_max_fee_in_strk: "0xa",
  },
  fee_action: {
    amount: overrides.amount ?? "0x5",
    recipient: overrides.recipient ?? "0x4",
    token: "0x3",
    type: "withdraw",
  },
  parameters: { fee_mode: { mode: "sponsored_private" }, version: "0x1" },
  type: "apply_action",
  ...(overrides.typedData === undefined ? {} : { typed_data: overrides.typedData }),
});

const build = (result: unknown, approveCalls: readonly Call[] = []) =>
  buildStrk20PaymasterPlan({
    accountAddress: "0x1",
    approveCalls,
    chainId: "0x534e5f5345504f4c4941",
    config,
    feeBound: { amount: 5n, kind: "exact" as const },
    http: async () => response(result),
    nowSeconds: 2,
    poolAddress: "0x2",
  });

describe("STRK20 paymaster unlinkability and fee bounds", () => {
  test("rejects a fee withdrawal to the active public account", async () => {
    await expect(build(quote({ recipient: "0x0001" }))).rejects.toThrow(
      "strk20 private submission unavailable",
    );
  });

  test("rejects any fee amount different from the independently read pool fee", async () => {
    for (const amount of ["0x4", "0x6"]) {
      await expect(build(quote({ amount }))).rejects.toThrow(
        "strk20 private submission unavailable",
      );
    }
  });

  test("rejects typed data on a private-only apply-action quote", async () => {
    const typedData = outsideExecution.getTypedData(
      "0x534e5f5345504f4c4941",
      { caller: "0x99", execute_after: "0x1", execute_before: "0x100" },
      "0x5",
      [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "approve" }],
      OutsideExecutionVersion.V2,
    );
    await expect(build(quote({ typedData }))).rejects.toThrow(
      "strk20 private submission unavailable",
    );
  });

  test("binds a mixed-route fee recipient to the reviewed authorization caller", async () => {
    const approval: Call = {
      calldata: ["0x2", "0x5", "0x0"],
      contractAddress: "0x3",
      entrypoint: "approve",
    };
    const typedData = outsideExecution.getTypedData(
      "0x534e5f5345504f4c4941",
      { caller: "0x99", execute_after: "0x1", execute_before: "0x100" },
      "0x5",
      [approval],
      OutsideExecutionVersion.V2,
    );
    await expect(
      build({ ...quote(), type: "invoke_and_apply_action", typed_data: typedData }, [approval]),
    ).rejects.toThrow("strk20 private submission unavailable");
  });
});
