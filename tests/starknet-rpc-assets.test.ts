/**
 * ERC721 ownership reads and ERC20 approve-call construction. `getNftOwner` is
 * driven through a spied `RpcProvider.prototype.callContract` (the module builds
 * its own provider via withRpcFallback's default factory): it returns canonical
 * hex from the snake_case `owner_of` entrypoint, falls back to camelCase
 * `ownerOf` when the first entrypoint faults semantically, rethrows transport
 * failures, and throws when neither entrypoint yields a field-element owner.
 * buildErc20ApproveCall's invalid-address guard is asserted the way
 * tests/starknet-rpc.test.ts asserts the transfer-call guard.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { RpcProvider } from "starknet";
import { WalletError } from "../src/shared/errors";
import { buildErc20ApproveCall, getNftOwner } from "../src/starknet/rpc-assets";

const CONTRACT = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const OWNER = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";

type CallArg = { readonly entrypoint: string };

const spies: { mockRestore: () => void }[] = [];
const spyCallContract = (impl: (call: CallArg) => Promise<readonly string[]>): void => {
  const spy = spyOn(RpcProvider.prototype, "callContract").mockImplementation(((call: CallArg) =>
    impl(call)) as never);
  spies.push(spy);
};

afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

describe("getNftOwner", () => {
  test("reads the owner via owner_of and returns canonical hex", async () => {
    const seen: string[] = [];
    // The node returns a leading-zero-padded felt; the reader canonicalizes it.
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      return ["0x00000abc"];
    });

    const owner = await getNftOwner({
      contractAddress: CONTRACT,
      rpcUrls: ["https://rpc.example"],
      tokenId: "42",
    });

    expect(owner).toBe("0xabc");
    // The snake_case entrypoint answered first, so no fallback was needed.
    expect(seen).toEqual(["owner_of"]);
  });

  test("falls back to ownerOf when owner_of faults semantically", async () => {
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      if (call.entrypoint === "owner_of") {
        // A semantic RPC error (baseError.code present) is not transport-level,
        // so it is swallowed and the camelCase entrypoint is tried next.
        throw Object.assign(new Error("entrypoint not found"), {
          baseError: { code: 21, message: "entrypoint not found" },
        });
      }
      return [OWNER];
    });

    const owner = await getNftOwner({
      contractAddress: CONTRACT,
      rpcUrls: ["https://rpc.example"],
      tokenId: "7",
    });

    expect(owner).toBe(`0x${BigInt(OWNER).toString(16)}`);
    expect(seen).toEqual(["owner_of", "ownerOf"]);
  });

  test("rethrows a transport error instead of masking it as unreadable", async () => {
    spyCallContract(async () => {
      // No baseError.code → transport-level → must propagate.
      throw new Error("fetch failed");
    });

    await expect(
      getNftOwner({ contractAddress: CONTRACT, rpcUrls: ["https://rpc.example"], tokenId: "1" }),
    ).rejects.toThrow("fetch failed");
  });

  test("throws when neither entrypoint returns a field-element owner", async () => {
    const seen: string[] = [];
    spyCallContract(async (call) => {
      seen.push(call.entrypoint);
      // A malformed response: no valid felt in slot 0.
      return call.entrypoint === "owner_of" ? [] : ["not-a-felt"];
    });

    await expect(
      getNftOwner({ contractAddress: CONTRACT, rpcUrls: ["https://rpc.example"], tokenId: "9" }),
    ).rejects.toThrow("Could not read NFT owner");
    // Both entrypoints were attempted before giving up.
    expect(seen).toEqual(["owner_of", "ownerOf"]);
  });

  test("rejects an invalid NFT contract address before any RPC call", async () => {
    let called = false;
    spyCallContract(async () => {
      called = true;
      return [OWNER];
    });

    await expect(
      getNftOwner({ contractAddress: "0x0", rpcUrls: ["https://rpc.example"], tokenId: "1" }),
    ).rejects.toThrow("Invalid NFT contract address");
    expect(called).toBe(false);
  });
});

describe("buildErc20ApproveCall", () => {
  test("builds an approve call for valid addresses", () => {
    expect(buildErc20ApproveCall("0x1", "0x2", 5n)).toEqual({
      calldata: ["2", "5", "0"],
      contractAddress: "0x1",
      entrypoint: "approve",
    });
  });

  test("rejects a zero token or spender address", () => {
    expect(() => buildErc20ApproveCall("0x0", "0x2", 5n)).toThrow(WalletError);
    expect(() => buildErc20ApproveCall("0x1", "0x0", 5n)).toThrow("Invalid approval address");
  });
});
