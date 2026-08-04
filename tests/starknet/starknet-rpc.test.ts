/**
 * Starknet RPC helper checks cover token amount math, calldata construction,
 * and counterfactual account deployment parameters.
 */
import { describe, expect, test } from "bun:test";
import { CallData, hash, shortString } from "starknet";
import { WalletError } from "../../src/shared/errors";
import { withRpcFailureDetail } from "../../src/starknet/provider";
import {
  buildErc20TransferCall,
  decodeErc20String,
  formatTokenAmount,
  isContractNotFoundError,
  isTransportRpcError,
  ozAccountDeployment,
  parseTokenAmount,
  withRpcFallback,
  withRpcWrite,
} from "../../src/starknet/rpc";
import type { AccountRef } from "../../src/storage/vault-schema";

const PUBLIC_KEY = "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const CLASS_HASH = "0x2b31e19e45c06f29234e06e2ee98a9966479ba3067f8785ed972794fdb0065c";

const ozAccount = (address: string): AccountRef => ({
  address,
  classHash: CLASS_HASH,
  derivation: { accountIndex: 0, addressIndex: 0, kind: "starknet-bip44" },
  id: `SN_MAIN:${address}`,
  networkId: "SN_MAIN",
  publicKeyX: PUBLIC_KEY,
  publicKeyY: "0x5234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
});

describe("starknet RPC helpers", () => {
  test("parses and formats token amounts without floating point math", () => {
    expect(parseTokenAmount("1.25", 18).toString()).toBe("1250000000000000000");
    expect(formatTokenAmount(1250000000000000000n, 18)).toBe("1.25");
    expect(() => parseTokenAmount("0", 18)).toThrow("greater than zero");
    expect(() => parseTokenAmount("1.001", 2)).toThrow("Too many decimal places");
  });

  test("builds ERC20 transfer calldata", () => {
    expect(buildErc20TransferCall("0x1", "0x2", 3n)).toEqual({
      calldata: ["2", "3", "0"],
      contractAddress: "0x1",
      entrypoint: "transfer",
    });
    expect(() => buildErc20TransferCall("0x0", "0x2", 3n)).toThrow("Invalid transfer address");
  });

  test("builds OZ deployment parameters that reproduce the stored address", () => {
    const krustyAddress = hash.calculateContractAddressFromHash(
      "0x0",
      CLASS_HASH,
      CallData.compile([PUBLIC_KEY]),
      0,
    );
    const krustyDeployment = ozAccountDeployment(ozAccount(krustyAddress));
    expect(krustyDeployment.addressSalt).toBe("0x0");
    expect(krustyDeployment.classHash).toBe(CLASS_HASH);
    expect(krustyDeployment.constructorCalldata).toEqual(CallData.compile([PUBLIC_KEY]));
    expect(krustyDeployment.contractAddress).toBe(krustyAddress);

    const importedAddress = hash.calculateContractAddressFromHash(
      PUBLIC_KEY,
      CLASS_HASH,
      CallData.compile([PUBLIC_KEY]),
      0,
    );
    const importedDeployment = ozAccountDeployment(ozAccount(importedAddress));
    expect(importedDeployment.addressSalt).toBe(PUBLIC_KEY);
    expect(importedDeployment.contractAddress).toBe(importedAddress);
  });

  test("refuses deployment parameters that would land at a different address", () => {
    const wrongAddress = "0x6c16710431efd3962d3c6f55faf00d8c855188029acb42781b9ac77c438ade5";
    expect(() => ozAccountDeployment(ozAccount(wrongAddress))).toThrow(
      "do not match the stored address",
    );
  });

  test("fails over to the next RPC endpoint only on transport errors", async () => {
    const attempts: string[] = [];
    const flaky = await withRpcFallback(
      ["https://one.example", "https://two.example"],
      async (provider) => {
        attempts.push(String(provider));
        if (attempts.length === 1) {
          throw new Error("fetch failed");
        }
        return "recovered";
      },
      (nodeUrl) => nodeUrl as unknown as import("starknet").RpcProvider,
    );
    expect(flaky).toBe("recovered");
    expect(attempts).toEqual(["https://one.example", "https://two.example"]);

    const semantic = Object.assign(new Error("Contract not found"), {
      baseError: { code: 20, message: "Contract not found" },
    });
    const calls: string[] = [];
    await expect(
      withRpcFallback(
        ["https://one.example", "https://two.example"],
        async (provider) => {
          calls.push(String(provider));
          throw semantic;
        },
        (nodeUrl) => nodeUrl as unknown as import("starknet").RpcProvider,
      ),
    ).rejects.toBe(semantic);
    expect(calls).toEqual(["https://one.example"]);
  });

  test("preflights write endpoints but never retries after execution begins", async () => {
    const made: string[] = [];
    const writes: string[] = [];
    const provider = (nodeUrl: string) =>
      ({
        async getChainId() {
          if (nodeUrl.includes("offline")) {
            throw new Error("fetch failed");
          }
          return "0x534e5f4d41494e";
        },
        toString() {
          return nodeUrl;
        },
      }) as unknown as import("starknet").RpcProvider;

    await expect(
      withRpcWrite(
        ["https://offline.example", "https://selected.example", "https://unused.example"],
        "0x534e5f4d41494e",
        async (selected) => {
          writes.push(String(selected));
          throw new Error("connection reset after submit");
        },
        (nodeUrl) => {
          made.push(nodeUrl);
          return provider(nodeUrl);
        },
      ),
    ).rejects.toThrow("submission status is unknown");

    expect(made).toEqual(["https://offline.example", "https://selected.example"]);
    expect(writes).toEqual(["https://selected.example"]);
  });

  test("classifies transport versus semantic RPC failures", () => {
    expect(isTransportRpcError(new Error("fetch failed"))).toBe(true);
    expect(
      isTransportRpcError(
        Object.assign(new Error("RPC error"), { baseError: { code: 41, message: "" } }),
      ),
    ).toBe(false);
    expect(isTransportRpcError(new WalletError("Invalid account address"))).toBe(false);
  });

  test("withRpcFailureDetail maps only semantic rejections, and passes the rest through", async () => {
    await expect(withRpcFailureDetail(async () => "ok")).resolves.toBe("ok");

    // A curated WalletError is already the best message available; re-mapping it
    // would replace e.g. ensureAccountDeployed's guidance with a bare RPC code.
    const curated = new WalletError("This account is not deployed on-chain yet");
    await expect(withRpcFailureDetail(() => Promise.reject(curated))).rejects.toBe(curated);

    // Transport failures must reach withRpcWrite/withRpcFallback unchanged so
    // their failover and fail-closed wording still apply.
    const transport = new Error("fetch failed");
    await expect(withRpcFailureDetail(() => Promise.reject(transport))).rejects.toBe(transport);

    await expect(
      withRpcFailureDetail(() =>
        Promise.reject(
          Object.assign(new Error("RPC: starknet_call with params {...}"), {
            baseError: { code: 21, message: "Requested entrypoint does not exist in the contract" },
          }),
        ),
      ),
    ).rejects.toThrow("The network could not execute this transaction (RPC error 21).");
  });

  test("classifies contract-not-found RPC failures", () => {
    expect(
      isContractNotFoundError(new Error("RPC: starknet_getClassHashAt Contract not found")),
    ).toBe(true);
    expect(
      isContractNotFoundError(
        Object.assign(new Error("RPC error"), { baseError: { code: 20, message: "" } }),
      ),
    ).toBe(true);
    expect(isContractNotFoundError(new Error("connection reset"))).toBe(false);
    expect(isContractNotFoundError("Contract not found")).toBe(false);
  });

  test("decodes ERC20 name/symbol from felt short strings and byte arrays", () => {
    expect(decodeErc20String(["0x55534443"])).toBe("USDC");
    expect(decodeErc20String([shortString.encodeShortString("Ether")])).toBe("Ether");
    expect(decodeErc20String(["0x0", shortString.encodeShortString("USD Coin"), "0x8"])).toBe(
      "USD Coin",
    );
    expect(
      decodeErc20String([
        "0x1",
        shortString.encodeShortString("A".repeat(31)),
        shortString.encodeShortString("BC"),
        "0x2",
      ]),
    ).toBe(`${"A".repeat(31)}BC`);
    expect(decodeErc20String(["not-hex"])).toBe("");
    expect(decodeErc20String([])).toBe("");
    // A multi-word response whose leading word is not a parseable felt cannot
    // yield a ByteArray length, so the decoder falls back to the first word.
    expect(decodeErc20String(["not-a-number", "0x1"])).toBe("");
  });
});
