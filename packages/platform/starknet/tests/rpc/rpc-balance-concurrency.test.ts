/** Token balance reads stay bounded so one screen cannot saturate an endpoint. */
import { expect, test } from "bun:test";
import { getTokenBalances } from "@mc-wallet/starknet/rpc";
import type { TokenConfig } from "@mc-wallet/wallet-model/preferences";
import type { RpcProvider } from "starknet";

const ACCOUNT_ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
const TOKEN: TokenConfig = {
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
  id: "SN_MAIN:ETH:0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  name: "Ether",
  networkId: "SN_MAIN",
  symbol: "ETH",
};

test("bounds concurrent token balance reads", async () => {
  let active = 0;
  let maximum = 0;
  const tokens = Array.from({ length: 9 }, (_, index) => ({
    ...TOKEN,
    address: `0x${(index + 1).toString(16)}`,
    id: `SN_MAIN:T${index}:0x${(index + 1).toString(16)}`,
    symbol: `T${index}`,
  }));
  await getTokenBalances(
    { accountAddress: ACCOUNT_ADDRESS, rpcUrls: ["https://rpc.example"], tokens },
    () =>
      ({
        callContract: async () => {
          active += 1;
          maximum = Math.max(maximum, active);
          await Promise.resolve();
          active -= 1;
          return ["0x1", "0x0"];
        },
      }) as unknown as RpcProvider,
  );
  expect(maximum).toBe(4);
});
