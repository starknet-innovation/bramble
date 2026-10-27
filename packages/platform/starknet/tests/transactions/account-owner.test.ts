/**
 * The owner read behind importing an account by address (issue 398): a known
 * class read with its family's own reader, every other answer a distinct
 * refusal, and an unreadable chain a throw rather than "no owner".
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { resetRpcEndpointCooldownsForTests } from "@bramble/starknet/provider";
import { getAccountOwner } from "@bramble/starknet/rpc";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
  deploymentClasses,
} from "@bramble/wallet-model/account-families";
import type { RpcProvider } from "starknet";

const ADDRESS = "0x123";
const OWNER = "0xabc";
const RPC = ["https://rpc.example"];

type Reads = Readonly<Record<string, readonly string[]>>;

const MAINNET = "0x534e5f4d41494e";

const providerOf = (
  liveClass: string | Error,
  reads: Reads = {},
  calls: string[] = [],
  chainId = MAINNET,
) =>
  ({
    async getChainId() {
      return chainId;
    },
    async getBlockLatestAccepted() {
      return { block_hash: "0xb10c" };
    },
    async getClassHashAt() {
      if (liveClass instanceof Error) throw liveClass;
      return liveClass;
    },
    async callContract({ entrypoint }: { readonly entrypoint: string }) {
      calls.push(entrypoint);
      const result = reads[entrypoint];
      if (!result) throw new Error(`unexpected read: ${entrypoint}`);
      return [...result];
    },
  }) as unknown as RpcProvider;

const read = (provider: RpcProvider, accountAddress = ADDRESS) =>
  getAccountOwner({ accountAddress, chainId: MAINNET, rpcUrls: RPC }, () => provider);

beforeEach(() => resetRpcEndpointCooldownsForTests());

describe("getAccountOwner", () => {
  test("reads an Argent 0.4 owner once the owner type says Starknet", async () => {
    await expect(
      read(providerOf(ARGENT_ACCOUNT_CLASS_HASH, { get_owner: [OWNER], get_owner_type: ["0x0"] })),
    ).resolves.toEqual({
      classHash: ARGENT_ACCOUNT_CLASS_HASH,
      family: "argent",
      kind: "owner",
      ownerPublicKey: OWNER,
    });
  });

  test("refuses an Argent owner of another signer type, without reading a key", async () => {
    const calls: string[] = [];
    await expect(
      read(providerOf(ARGENT_ACCOUNT_CLASS_HASH, { get_owner_type: ["0x2"] }, calls)),
    ).resolves.toEqual({ family: "argent", kind: "non-stark-owner", ownerType: "0x2" });
    expect(calls).toEqual(["get_owner_type"]);
  });

  test("reads an Argent 0.3.x owner directly: that release has no owner type", async () => {
    const argent030 = deploymentClasses("argent").find((entry) => entry.label === "argent 0.3.0");
    if (!argent030) throw new Error("argent 0.3.0 missing from the class table");
    const calls: string[] = [];
    await expect(
      read(providerOf(argent030.classHash, { get_owner: [OWNER] }, calls)),
    ).resolves.toMatchObject({ family: "argent", kind: "owner", ownerPublicKey: OWNER });
    expect(calls).toEqual(["get_owner"]);
  });

  test("reads a Braavos owner as the first stark signer", async () => {
    await expect(
      read(
        providerOf(BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH, {
          get_signers: ["0x2", OWNER, "0xdef", "0x0", "0x0"],
        }),
      ),
    ).resolves.toEqual({
      classHash: BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH,
      family: "braavos",
      kind: "owner",
      ownerPublicKey: OWNER,
    });
  });

  test("refuses a Braavos account no stark key controls", async () => {
    await expect(
      read(
        providerOf(BRAAVOS_CURRENT_IMPLEMENTATION_CLASS_HASH, {
          get_signers: ["0x0", "0x0", "0x1", "0x5"],
        }),
      ),
    ).resolves.toEqual({ family: "braavos", kind: "non-stark-owner", ownerType: null });
  });

  test("an unknown class, including a 2023-era contract, is unsupported", async () => {
    await expect(
      read(providerOf("0x3131fa018d520a037686ce3efddeab8f28895662f019ca3ca18a626650f7d1e")),
    ).resolves.toEqual({
      kind: "unsupported-class",
    });
  });

  test("nothing deployed, or the zero class, is not deployed", async () => {
    await expect(read(providerOf(new Error("Contract not found")))).resolves.toEqual({
      kind: "not-deployed",
    });
    await expect(read(providerOf("0x0"))).resolves.toEqual({ kind: "not-deployed" });
  });

  test("an unreadable or malformed answer throws instead of answering", async () => {
    await expect(read(providerOf(new Error("socket hang up")))).rejects.toThrow();
    resetRpcEndpointCooldownsForTests();
    await expect(
      read(providerOf(ARGENT_ACCOUNT_CLASS_HASH, { get_owner: ["0x0"], get_owner_type: ["0x0"] })),
    ).rejects.toThrow("Account returned a malformed owner key");
    await expect(
      read(
        providerOf(ARGENT_ACCOUNT_CLASS_HASH, {
          get_owner: [OWNER, OWNER],
          get_owner_type: ["0x0"],
        }),
      ),
    ).rejects.toThrow("Account returned a malformed owner key");
  });

  test("an endpoint serving another chain refuses before reading the account", async () => {
    const calls: string[] = [];
    await expect(
      read(
        providerOf(
          ARGENT_ACCOUNT_CLASS_HASH,
          { get_owner: [OWNER] },
          calls,
          "0x534e5f5345504f4c4941",
        ),
      ),
    ).rejects.toThrow("RPC endpoint returned the wrong Starknet chain");
    expect(calls).toEqual([]);
  });

  test("a malformed owner type is unreadable, not a verdict", async () => {
    for (const ownerType of [[], ["0x0", "0x1"], ["not-a-felt"]]) {
      resetRpcEndpointCooldownsForTests();
      await expect(
        read(
          providerOf(ARGENT_ACCOUNT_CLASS_HASH, { get_owner: [OWNER], get_owner_type: ownerType }),
        ),
      ).rejects.toThrow("Account returned a malformed owner type");
    }
  });

  test("a well-formed nonzero owner type is another kind of signer, carried canonical", async () => {
    const cases: readonly (readonly [string, string])[] = [
      ["0x1", "0x1"],
      ["0x02", "0x2"],
    ];
    for (const [answer, ownerType] of cases) {
      resetRpcEndpointCooldownsForTests();
      await expect(
        read(providerOf(ARGENT_ACCOUNT_CLASS_HASH, { get_owner_type: [answer] })),
      ).resolves.toEqual({ family: "argent", kind: "non-stark-owner", ownerType });
    }
  });

  test("an address that is not a felt is refused before any read", async () => {
    const calls: string[] = [];
    await expect(
      read(providerOf(ARGENT_ACCOUNT_CLASS_HASH, {}, calls), "not-an-address"),
    ).rejects.toThrow("Invalid account address");
    expect(calls).toEqual([]);
  });
});
