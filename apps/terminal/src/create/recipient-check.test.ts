import type { RpcProvider } from "starknet";
import { describe, expect, test, vi } from "vitest";
import { assertErc1155Recipient } from "./recipient-check";

const SEPOLIA = "0x534e5f5345504f4c4941";
const MAINNET = "0x534e5f4d41494e";
const RECIPIENT = "0x5";
// OpenZeppelin Cairo v3.0.0 `IERC1155_RECEIVER_ID` and `ISRC6_ID`.
const RECEIVER = "0x15e8665b5af20040c3af1670509df02eb916375cdf7d8cbaf7bd553a257515e";
const SRC6 = "0x2ceccef7f994940b3962a6c67e0ba4fcd37df7d131417c604f91e03caecc1cd";

const rpcError = (code: number): Error =>
  Object.assign(new Error(`rpc ${code}`), { baseError: { code, message: "x" } });

type Reply = readonly string[] | Error;

const provider = (answers: { readonly receiver: Reply; readonly src6?: Reply }) => {
  const value = {
    callContract: vi.fn(async (call: { readonly calldata: readonly string[] }) => {
      const reply = call.calldata[0] === RECEIVER ? answers.receiver : (answers.src6 ?? ["0x0"]);
      if (reply instanceof Error) throw reply;
      return reply;
    }),
  };
  return { makeProvider: () => value as unknown as RpcProvider, value };
};

const asked = (rpc: ReturnType<typeof provider>): readonly unknown[] =>
  rpc.value.callContract.mock.calls.map(([call]) => call);

const question = (interfaceId: string) => ({
  calldata: [interfaceId],
  contractAddress: RECIPIENT,
  entrypoint: "supports_interface",
});

describe("assertErc1155Recipient", () => {
  test("an account passes on SRC6 after saying no to the receiver interface", async () => {
    const rpc = provider({ receiver: ["0x0"], src6: ["0x1"] });
    await expect(assertErc1155Recipient(SEPOLIA, RECIPIENT, rpc)).resolves.toBeUndefined();
    expect(asked(rpc)).toEqual([question(RECEIVER), question(SRC6)]);
  });

  test("a contract with the ERC-1155 receiver interface passes without the SRC6 question", async () => {
    const rpc = provider({ receiver: ["0x01"] });
    await expect(assertErc1155Recipient(SEPOLIA, RECIPIENT, rpc)).resolves.toBeUndefined();
    expect(asked(rpc)).toEqual([question(RECEIVER)]);
  });

  test("refuses a contract that says no to both, as the preset's mint would", async () => {
    const cannot = "The recipient can't receive ERC-1155 tokens.";
    await expect(
      assertErc1155Recipient(SEPOLIA, RECIPIENT, provider({ receiver: ["0x0"], src6: ["0x0"] })),
    ).rejects.toThrow(cannot);
    // A malformed reply is not a yes.
    await expect(
      assertErc1155Recipient(SEPOLIA, RECIPIENT, provider({ receiver: [], src6: ["0x1", "0x1"] })),
    ).rejects.toThrow(cannot);
    // An SRC6 answer that is neither 0 nor 1 is not a yes.
    await expect(
      assertErc1155Recipient(SEPOLIA, RECIPIENT, provider({ receiver: ["0x0"], src6: ["0x2"] })),
    ).rejects.toThrow(cannot);
    // No SRC5 entry point (21) or a failed call (40): the mint would revert too.
    await expect(
      assertErc1155Recipient(SEPOLIA, RECIPIENT, provider({ receiver: rpcError(21), src6: rpcError(21) })),
    ).rejects.toThrow(cannot);
    await expect(
      assertErc1155Recipient(SEPOLIA, RECIPIENT, provider({ receiver: rpcError(40), src6: rpcError(40) })),
    ).rejects.toThrow(cannot);
  });

  test("a failed or malformed receiver answer is refused without asking SRC6, as the preset reverts there", async () => {
    for (const receiver of [rpcError(21), rpcError(40), [], ["0x2"], ["0x0", "0x0"]]) {
      const rpc = provider({ receiver, src6: ["0x1"] });
      await expect(assertErc1155Recipient(SEPOLIA, RECIPIENT, rpc)).rejects.toThrow(
        "The recipient can't receive ERC-1155 tokens.",
      );
      expect(asked(rpc)).toEqual([question(RECEIVER)]);
    }
  });

  test("refuses an address with nothing deployed", async () => {
    const rpc = provider({ receiver: rpcError(20) });
    await expect(assertErc1155Recipient(SEPOLIA, RECIPIENT, rpc)).rejects.toThrow(
      "No contract is deployed at the recipient address.",
    );
    expect(rpc.value.callContract).toHaveBeenCalledTimes(1);
  });

  test("fails closed when the network can't be read, at either question", async () => {
    const unreadable = "Couldn't check the recipient. Try again.";
    await expect(
      assertErc1155Recipient(SEPOLIA, RECIPIENT, provider({ receiver: new TypeError("fetch failed") })),
    ).rejects.toThrow(unreadable);
    await expect(
      assertErc1155Recipient(SEPOLIA, RECIPIENT, provider({ receiver: ["0x0"], src6: new TypeError("fetch failed") })),
    ).rejects.toThrow(unreadable);
    // Any other node error (here invalid params, -32602) is not a verdict about the recipient.
    await expect(
      assertErc1155Recipient(SEPOLIA, RECIPIENT, provider({ receiver: rpcError(-32602), src6: ["0x1"] })),
    ).rejects.toThrow(unreadable);
  });

  test("refuses a network Create is off for, before any read", async () => {
    const rpc = provider({ receiver: ["0x1"] });
    await expect(assertErc1155Recipient(MAINNET, RECIPIENT, rpc)).rejects.toThrow("Sepolia only");
    expect(rpc.value.callContract).not.toHaveBeenCalled();
  });
});
