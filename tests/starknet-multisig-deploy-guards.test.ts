/**
 * Validation-throw and class-status branches of the multisig deployment
 * builders not covered by tests/starknet-multisig.test.ts: the invalid-salt
 * guard in requireConfig, and isMultisigClassDeclared's error classification —
 * a class-hash-not-found answer maps to `false`, a malformed compiled class
 * throws, a non-Error thrown value is not treated as class-not-found and
 * propagates, and other errors propagate too. Drives the class reader through
 * an injected `makeProvider` the way the multisig suite already does.
 */
import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import {
  buildMultisigDeployCall,
  isMultisigClassDeclared,
  predictMultisigAddress,
} from "../src/starknet/multisig-deploy";

const SIGNER_A = "0x333333333333333333333333333333333333333333333333333333333333333";
const SIGNER_B = "0x444444444444444444444444444444444444444444444444444444444444444";
const config = { quorum: 2, salt: "0x0", signers: [SIGNER_A, SIGNER_B] };

const makeProvider = (impl: Record<string, () => Promise<unknown>>) => (): RpcProvider =>
  ({
    async getClassByHash() {
      return {};
    },
    async getCompiledCasm() {
      return {};
    },
    ...impl,
  }) as unknown as RpcProvider;

describe("multisig deploy config validation", () => {
  test("rejects a non-felt salt", () => {
    expect(() => buildMultisigDeployCall({ ...config, salt: "not-a-felt" })).toThrow(
      "Invalid multisig salt",
    );
    expect(() => predictMultisigAddress({ ...config, salt: "not-a-felt" })).toThrow(
      "Invalid multisig salt",
    );
  });
});

describe("isMultisigClassDeclared", () => {
  test("maps a class-hash-not-found answer to false", async () => {
    const declared = await isMultisigClassDeclared({
      makeProvider: makeProvider({
        async getClassByHash() {
          throw new Error("RPC: starknet_getClass Class hash not found");
        },
      }),
      rpcUrls: ["https://rpc.example"],
    });
    expect(declared).toBe(false);
  });

  test("throws when the declared compiled class is malformed", async () => {
    // computeCompiledClassHash throws on the empty casm object, so the reader
    // surfaces the malformed-class error rather than a boolean.
    await expect(
      isMultisigClassDeclared({
        makeProvider: makeProvider({
          async getCompiledCasm() {
            return {};
          },
        }),
        rpcUrls: ["https://rpc.example"],
      }),
    ).rejects.toThrow("Declared multisig class is malformed");
  });

  test("propagates a non-Error thrown value (never misread as not-found)", async () => {
    await expect(
      isMultisigClassDeclared({
        makeProvider: makeProvider({
          async getClassByHash() {
            // A thrown non-Error is not class-not-found, so it must propagate.
            throw "boom";
          },
        }),
        rpcUrls: ["https://rpc.example"],
      }),
    ).rejects.toBe("boom");
  });
});
