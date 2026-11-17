/**
 * Stable Argent Multisig 0.2 constructor and class-declaration guards.
 */
import { describe, expect, test } from "bun:test";
import {
  argentMultisigDeployment,
  canonicalArgentMultisigDeployConfig,
  isArgentMultisigClassDeclared,
  predictArgentMultisigAddress,
} from "@bramble/multisig/deploy";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@bramble/starknet/account-contracts";
import type { RpcProvider } from "starknet";

const SIGNER_A = "0x123";
const SIGNER_B = "0x456";
const config = { salt: "0x0", signerPublicKeys: [SIGNER_A, SIGNER_B], threshold: 2 };

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

describe("Argent multisig deployment", () => {
  test("normalizes signer input into deterministic GUID order", () => {
    const expected = [SIGNER_A, SIGNER_B].sort((left, right) =>
      BigInt(argentSignerGuid(left)) < BigInt(argentSignerGuid(right)) ? -1 : 1,
    );
    expect(canonicalArgentMultisigDeployConfig(config).signerPublicKeys).toEqual(expected);
    expect(
      predictArgentMultisigAddress({
        ...config,
        signerPublicKeys: [...config.signerPublicKeys].reverse(),
      }),
    ).toBe(predictArgentMultisigAddress(config));
  });

  test("builds address-proven direct DEPLOY_ACCOUNT metadata", () => {
    const deployment = argentMultisigDeployment(config);
    expect(deployment).toMatchObject({
      addressSalt: "0x0",
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      contractAddress: predictArgentMultisigAddress(config),
    });
    expect(deployment.constructorCalldata).toHaveLength(6);
  });

  test("rejects invalid salts, signer sets, and thresholds", () => {
    for (const invalid of [
      { ...config, salt: "not-a-felt" },
      { ...config, signerPublicKeys: [] },
      { ...config, signerPublicKeys: [SIGNER_A, SIGNER_A] },
      { ...config, signerPublicKeys: ["0x0"] },
      { ...config, threshold: 0 },
      { ...config, threshold: 3 },
    ]) {
      expect(() => argentMultisigDeployment(invalid)).toThrow();
    }
  });
});

describe("isArgentMultisigClassDeclared", () => {
  test("maps only class-hash-not-found to false", async () => {
    await expect(
      isArgentMultisigClassDeclared({
        makeProvider: makeProvider({
          async getClassByHash() {
            throw new Error("RPC: starknet_getClass Class hash not found");
          },
        }),
        rpcUrls: ["https://rpc.example"],
      }),
    ).resolves.toBe(false);
  });

  test("rejects malformed compiled class data", async () => {
    await expect(
      isArgentMultisigClassDeclared({
        makeProvider: makeProvider({}),
        rpcUrls: ["https://rpc.example"],
      }),
    ).rejects.toThrow("Declared Argent multisig class is malformed");
  });

  test("propagates non-class-not-found failures", async () => {
    await expect(
      isArgentMultisigClassDeclared({
        makeProvider: makeProvider({
          async getClassByHash() {
            throw new Error("transport failed");
          },
        }),
        rpcUrls: ["https://rpc.example"],
      }),
    ).rejects.toThrow("transport failed");
  });
});
