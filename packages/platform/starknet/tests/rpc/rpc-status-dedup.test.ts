/** Transaction status polling never repeats an identical hash in one pass. */
import { expect, test } from "bun:test";
import { getTransactionStatuses } from "@bramble/starknet/rpc";
import type { RpcProvider } from "starknet";

test("deduplicates transaction status reads", async () => {
  let calls = 0;
  const statuses = await getTransactionStatuses(
    { hashes: ["0x1", "0x1", "0x2", "0x1", "0x2"], rpcUrls: ["https://rpc.example"] },
    () =>
      ({
        async getTransactionStatus() {
          calls += 1;
          return { execution_status: "SUCCEEDED", finality_status: "ACCEPTED_ON_L2" };
        },
      }) as unknown as RpcProvider,
  );

  expect(calls).toBe(2);
  expect(Object.keys(statuses)).toEqual(["0x1", "0x2"]);
});
