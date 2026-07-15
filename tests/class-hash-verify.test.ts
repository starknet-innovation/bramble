/**
 * On-chain class-hash verification: the security-relevant check that the class
 * shown on the account screen matches the class actually deployed at the
 * account address. Covers the verified / mismatch / undeployed / unreachable
 * outcomes, felt normalization of the comparison, fail-closed behaviour on an
 * unexpected RPC error, and boundary validation of the inputs.
 */
import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import { WalletError } from "../src/shared/errors";
import {
  type ClassHashVerification,
  verifyAccountClassHash,
} from "../src/starknet/class-hash-verify";

const ADDRESS = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde";
// The OpenZeppelin AccountUpgradeable class hash the wallet advertises.
const EXPECTED = "0x1d1777db36cdd06dd62cfde77b1b6ae06412af95d57a13dc40ac77b8a702381";
// Same felt, left-padded to 64 hex digits and upper-cased — must still match.
const EXPECTED_PADDED = "0x01D1777DB36CDD06DD62CFDE77B1B6AE06412AF95D57A13DC40AC77B8A702381";
const OTHER_CLASS = "0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3";

const RPC_URLS = ["https://node.example/rpc"];

// Builds a makeProvider that yields a provider whose getClassHashAt resolves or
// rejects as the test dictates. Only getClassHashAt is exercised.
const providerWith = (
  getClassHashAt: (address: string, block: string) => Promise<string>,
): ((nodeUrl: string) => RpcProvider) => {
  return () => ({ getClassHashAt }) as unknown as RpcProvider;
};

const rpcError = (code: number, message: string): Error => {
  const error = new Error(message) as Error & { baseError?: { code: number } };
  error.baseError = { code };
  return error;
};

const verify = (
  makeProvider: (nodeUrl: string) => RpcProvider,
  overrides: { readonly accountAddress?: string; readonly expectedClassHash?: string } = {},
): Promise<ClassHashVerification> =>
  verifyAccountClassHash({
    accountAddress: overrides.accountAddress ?? ADDRESS,
    expectedClassHash: overrides.expectedClassHash ?? EXPECTED,
    makeProvider,
    rpcUrls: RPC_URLS,
  });

describe("verifyAccountClassHash", () => {
  test("returns verified when the deployed class hash matches", async () => {
    const result = await verify(providerWith(async () => EXPECTED));
    expect(result).toEqual({ onChainClassHash: EXPECTED, status: "verified" });
  });

  test("matches across leading-zero padding and letter case (felt normalization)", async () => {
    const result = await verify(providerWith(async () => EXPECTED_PADDED));
    expect(result).toEqual({ onChainClassHash: EXPECTED_PADDED, status: "verified" });
  });

  test("returns mismatch, carrying both hashes, when a different class is deployed", async () => {
    const result = await verify(providerWith(async () => OTHER_CLASS));
    expect(result).toEqual({
      expectedClassHash: EXPECTED,
      onChainClassHash: OTHER_CLASS,
      status: "mismatch",
    });
  });

  test("does not report verified when the node returns a non-felt value", async () => {
    const result = await verify(providerWith(async () => "not-a-felt"));
    expect(result.status).toBe("mismatch");
  });

  test("returns undeployed when the contract is not found (RPC code 20)", async () => {
    const result = await verify(
      providerWith(async () => {
        throw rpcError(20, "Contract not found");
      }),
    );
    expect(result).toEqual({ status: "undeployed" });
  });

  test("returns unreachable when the endpoint fails at the transport level", async () => {
    const result = await verify(
      providerWith(async () => {
        throw new Error("fetch failed: ECONNREFUSED");
      }),
    );
    expect(result).toEqual({ status: "unreachable" });
  });

  test("propagates an unexpected semantic RPC error rather than faking a result", async () => {
    await expect(
      verify(
        providerWith(async () => {
          throw rpcError(99, "unexpected node error");
        }),
      ),
    ).rejects.toThrow("unexpected node error");
  });

  test("rejects an invalid account address before any RPC call", async () => {
    let called = false;
    await expect(
      verify(
        providerWith(async () => {
          called = true;
          return EXPECTED;
        }),
        { accountAddress: "not-an-address" },
      ),
    ).rejects.toBeInstanceOf(WalletError);
    expect(called).toBe(false);
  });

  test("rejects an invalid expected class hash before any RPC call", async () => {
    await expect(
      verify(
        providerWith(async () => EXPECTED),
        { expectedClassHash: "0x0" },
      ),
    ).rejects.toBeInstanceOf(WalletError);
  });
});
