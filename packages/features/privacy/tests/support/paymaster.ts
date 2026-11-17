/** Shared deterministic fixtures for privacy-paymaster contract tests. */
import { type Call, OutsideExecutionVersion, outsideExecution, type TypedData } from "starknet";

export const paymasterConfig = { feeToken: "0x3", url: "https://paymaster.example" };
export const paymasterChainId = "0x534e5f5345504f4c4941";
export const paymasterCall: Call = {
  calldata: ["0x1"],
  contractAddress: "0x2",
  entrypoint: "apply_actions",
};

/** Builds valid outside-execution typed data around the supplied calls. */
export const paymasterTypedData = (calls: readonly Call[] = [paymasterCall]): TypedData =>
  outsideExecution.getTypedData(
    paymasterChainId,
    { caller: "0x99", execute_after: "0x1", execute_before: "0x100" },
    "0x5",
    [...calls],
    OutsideExecutionVersion.V2,
  );

/** Wraps a result in the exact JSON-RPC response envelope the client accepts. */
export const paymasterResponse = (result: unknown): Response =>
  new Response(JSON.stringify({ id: "bramble-strk20", jsonrpc: "2.0", result }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
