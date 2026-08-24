/** Supported signer-account public-key discovery. */
import { describe, expect, test } from "bun:test";
import { getMultisigSignerAccount } from "@mc-wallet/multisig/signer-account";
import { ARGENT_ACCOUNT_CONTRACT } from "@mc-wallet/starknet/account-contracts";
import { OPENZEPPELIN_ACCOUNT_CLASS_HASH } from "@mc-wallet/wallet-model/accounts";
import type { RpcProvider } from "starknet";

const ADDRESS = "0x123";
const BLOCK_HASH = "0xabc";
const PUBLIC_KEY = "0x456";
const RPC_URLS = ["https://rpc.example"];

const provider = (
  classHash: string,
  responses: Readonly<Record<string, readonly string[]>>,
): RpcProvider =>
  ({
    async callContract(request: { readonly entrypoint: string }, blockIdentifier?: string) {
      expect(blockIdentifier).toBe(BLOCK_HASH);
      return [...(responses[request.entrypoint] ?? [])];
    },
    async getBlockLatestAccepted() {
      return { block_hash: BLOCK_HASH, block_number: 1 };
    },
    async getClassHashAt(_address: string, blockIdentifier?: string) {
      expect(blockIdentifier).toBe(BLOCK_HASH);
      return classHash;
    },
  }) as unknown as RpcProvider;

describe("multisig signer account discovery", () => {
  test("resolves pinned OpenZeppelin and Argent Stark owners", async () => {
    await expect(
      getMultisigSignerAccount({
        address: ADDRESS,
        makeProvider: () =>
          provider(OPENZEPPELIN_ACCOUNT_CLASS_HASH, { get_public_key: [PUBLIC_KEY] }),
        rpcUrls: RPC_URLS,
      }),
    ).resolves.toEqual({
      accountContractType: "openzeppelin",
      address: ADDRESS,
      publicKeyX: PUBLIC_KEY,
    });

    await expect(
      getMultisigSignerAccount({
        address: ADDRESS,
        makeProvider: () =>
          provider(ARGENT_ACCOUNT_CONTRACT.classHash, {
            get_owner: [PUBLIC_KEY],
            get_owner_type: ["0x0"],
          }),
        rpcUrls: RPC_URLS,
      }),
    ).resolves.toEqual({
      accountContractType: "argent",
      address: ADDRESS,
      publicKeyX: PUBLIC_KEY,
    });
  });

  test("fails closed for undeployed, unknown, and non-Stark accounts", async () => {
    await expect(
      getMultisigSignerAccount({
        address: ADDRESS,
        makeProvider: () =>
          ({
            async getBlockLatestAccepted() {
              return { block_hash: BLOCK_HASH, block_number: 1 };
            },
            async getClassHashAt() {
              throw new Error("Contract not found");
            },
          }) as unknown as RpcProvider,
        rpcUrls: RPC_URLS,
      }),
    ).rejects.toThrow("not deployed yet");
    await expect(
      getMultisigSignerAccount({
        address: ADDRESS,
        makeProvider: () => provider("0x789", {}),
        rpcUrls: RPC_URLS,
      }),
    ).rejects.toThrow("cannot provide a signer key automatically");
    await expect(
      getMultisigSignerAccount({
        address: ADDRESS,
        makeProvider: () =>
          provider(ARGENT_ACCOUNT_CONTRACT.classHash, {
            get_owner: [PUBLIC_KEY],
            get_owner_type: ["0x1"],
          }),
        rpcUrls: RPC_URLS,
      }),
    ).rejects.toThrow("does not use a Stark public-key owner");
  });
});
