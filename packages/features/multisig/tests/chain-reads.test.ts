/**
 * Argent Multisig 0.2 config and signer-membership read boundaries.
 */
import { describe, expect, test } from "bun:test";
import {
  argentMultisigConfigChangeCall,
  getArgentMultisigConfig,
  getArgentMultisigSignerPublicKeys,
  isArgentMultisigCall,
  isArgentMultisigCalls,
  isArgentMultisigSignerGuid,
  nextArgentMultisigPublicConfig,
  parseArgentMultisigConfigChange,
  requireSafeArgentMultisigCalls,
  reviewArgentMultisigConfigChange,
} from "@mc-wallet/multisig/chain";
import { ARGENT_MULTISIG_CONTRACT, argentSignerGuid } from "@mc-wallet/starknet/account-contracts";
import type { RpcProvider } from "starknet";

const ADDRESS = "0x111";
const GUID_A = "0x123";
const GUID_B = "0x456";
const BLOCK_HASH = "0xabc";
const RPC_URLS = ["https://rpc.example"];

const makeProvider =
  (input: {
    readonly classHash?: string;
    readonly readBlocks?: string[];
    readonly responses?: Readonly<Record<string, readonly string[]>>;
    readonly thrown?: unknown;
  }) =>
  (): RpcProvider =>
    ({
      async callContract(request: { readonly entrypoint: string }, blockIdentifier?: string) {
        if (input.thrown !== undefined) {
          throw input.thrown;
        }
        if (blockIdentifier !== undefined) input.readBlocks?.push(blockIdentifier);
        const response = input.responses?.[request.entrypoint];
        if (!response) {
          throw new Error(`unexpected entrypoint ${request.entrypoint}`);
        }
        return [...response];
      },
      async getBlockLatestAccepted() {
        if (input.thrown !== undefined) {
          throw input.thrown;
        }
        return { block_hash: BLOCK_HASH, block_number: 123 };
      },
      async getClassHashAt(_address: string, blockIdentifier?: string) {
        if (input.thrown !== undefined) {
          throw input.thrown;
        }
        if (blockIdentifier !== undefined) input.readBlocks?.push(blockIdentifier);
        return input.classHash ?? ARGENT_MULTISIG_CONTRACT.classHash;
      },
    }) as unknown as RpcProvider;

const validProvider = (overrides: Readonly<Record<string, readonly string[]>> = {}) =>
  makeProvider({
    responses: {
      get_signer_guids: ["0x2", GUID_A, GUID_B],
      get_threshold: ["0x2"],
      is_signer_guid: ["0x1"],
      ...overrides,
    },
  });

describe("Argent multisig call validation", () => {
  test("accepts only canonical, bounded calls", () => {
    const call = { calldata: ["0x0", "0x1"], contractAddress: "0xabc", entrypoint: "transfer" };
    expect(isArgentMultisigCall(call)).toBe(true);
    expect(isArgentMultisigCall({ ...call, contractAddress: "0x0abc" })).toBe(false);
    expect(isArgentMultisigCall({ ...call, extra: true })).toBe(false);
    expect(isArgentMultisigCalls([call])).toBe(true);
    expect(isArgentMultisigCalls([])).toBe(false);
    expect(isArgentMultisigCalls(Array.from({ length: 17 }, () => call))).toBe(false);
  });

  test("mirrors stable 0.2 self-call restrictions", () => {
    const external = { calldata: [], contractAddress: "0xabc", entrypoint: "transfer" };
    expect(() => requireSafeArgentMultisigCalls(ADDRESS, [external])).not.toThrow();
    expect(() =>
      requireSafeArgentMultisigCalls(ADDRESS, [
        external,
        { calldata: [], contractAddress: ADDRESS, entrypoint: "change_threshold" },
      ]),
    ).toThrow("batches cannot contain account self-calls");
    for (const entrypoint of ["execute_after_upgrade", "perform_upgrade"]) {
      expect(() =>
        requireSafeArgentMultisigCalls(ADDRESS, [
          { calldata: [], contractAddress: ADDRESS, entrypoint },
        ]),
      ).toThrow("internal upgrade callbacks");
    }
    expect(() =>
      requireSafeArgentMultisigCalls(ADDRESS, [
        { calldata: ["0x2"], contractAddress: ADDRESS, entrypoint: "change_threshold" },
      ]),
    ).not.toThrow();
    expect(() =>
      requireSafeArgentMultisigCalls(ADDRESS, [
        { calldata: ["0x2"], contractAddress: ADDRESS, entrypoint: "set_threshold" },
      ]),
    ).toThrow("Unsupported Argent multisig self-call");
  });

  test("strictly parses and applies all four stable signer-management ABIs", () => {
    const initial = { signerPublicKeys: ["0x123", "0x456"], threshold: 2 } as const;
    const add = parseArgentMultisigConfigChange(ADDRESS, {
      calldata: ["0x2", "0x1", "0x0", "0x789"],
      contractAddress: ADDRESS,
      entrypoint: "add_signers",
    });
    expect(add).toEqual({ kind: "add_signers", signerPublicKeys: ["0x789"], threshold: 2 });
    const afterAdd = nextArgentMultisigPublicConfig(initial, add);
    expect(afterAdd).toEqual({ signerPublicKeys: ["0x789", "0x123", "0x456"], threshold: 2 });

    const threshold = parseArgentMultisigConfigChange(ADDRESS, {
      calldata: ["0x1"],
      contractAddress: ADDRESS,
      entrypoint: "change_threshold",
    });
    expect(nextArgentMultisigPublicConfig(afterAdd, threshold)).toEqual({
      signerPublicKeys: ["0x789", "0x123", "0x456"],
      threshold: 1,
    });

    const replace = parseArgentMultisigConfigChange(ADDRESS, {
      calldata: ["0x0", "0x456", "0x0", "0xabc"],
      contractAddress: ADDRESS,
      entrypoint: "replace_signer",
    });
    const afterReplace = nextArgentMultisigPublicConfig(afterAdd, replace);
    expect(afterReplace.signerPublicKeys).toEqual(["0x789", "0xabc", "0x123"]);
    expect(afterReplace.threshold).toBe(2);

    const remove = parseArgentMultisigConfigChange(ADDRESS, {
      calldata: ["0x1", "0x1", "0x0", "0x789"],
      contractAddress: ADDRESS,
      entrypoint: "remove_signers",
    });
    expect(nextArgentMultisigPublicConfig(afterReplace, remove)).toEqual({
      signerPublicKeys: ["0xabc", "0x123"],
      threshold: 1,
    });
    expect(
      reviewArgentMultisigConfigChange(ADDRESS, initial, {
        calldata: ["0x1"],
        contractAddress: ADDRESS,
        entrypoint: "change_threshold",
      }),
    ).toEqual({
      change: { kind: "change_threshold", threshold: 1 },
      nextConfig: { signerPublicKeys: ["0x123", "0x456"], threshold: 1 },
      summary: "Change Argent multisig threshold to 1",
    });
  });

  test("builds every guided signer-management action through the strict ABI parser", () => {
    for (const change of [
      { kind: "change_threshold", threshold: 1 },
      { kind: "add_signers", signerPublicKeys: ["0x789"], threshold: 2 },
      { kind: "remove_signers", signerPublicKeys: ["0x456"], threshold: 1 },
      {
        addSignerPublicKey: "0xabc",
        kind: "replace_signer",
        removeSignerPublicKey: "0x456",
      },
    ] as const) {
      const call = argentMultisigConfigChangeCall(ADDRESS, change);
      expect(parseArgentMultisigConfigChange(ADDRESS, call)).toEqual(change);
    }
  });

  test("rejects malformed or semantically impossible management transitions", () => {
    const initial = { signerPublicKeys: ["0x123", "0x456"], threshold: 2 } as const;
    for (const call of [
      { calldata: ["0x2"], contractAddress: "0x999", entrypoint: "change_threshold" },
      {
        calldata: ["0x2", "0x1", "0x1", "0x789"],
        contractAddress: ADDRESS,
        entrypoint: "add_signers",
      },
      {
        calldata: ["0x2", "0x2", "0x0", "0x789"],
        contractAddress: ADDRESS,
        entrypoint: "add_signers",
      },
      { calldata: ["0x2", "0x0"], contractAddress: ADDRESS, entrypoint: "change_threshold" },
      {
        calldata: ["0x0", "0x123", "0x0", "0x789", "0x0"],
        contractAddress: ADDRESS,
        entrypoint: "replace_signer",
      },
    ]) {
      expect(() => parseArgentMultisigConfigChange(ADDRESS, call)).toThrow();
    }
    expect(() =>
      nextArgentMultisigPublicConfig(initial, {
        kind: "remove_signers",
        signerPublicKeys: ["0x123", "0x123"],
        threshold: 1,
      }),
    ).toThrow("must be unique");
    expect(() =>
      nextArgentMultisigPublicConfig(initial, {
        kind: "replace_signer",
        removeSignerPublicKey: "0x789",
        addSignerPublicKey: "0xabc",
      }),
    ).toThrow("not configured");
  });
});

describe("getArgentMultisigConfig", () => {
  test("reads the pinned class, threshold, and ordered signer GUIDs", async () => {
    const readBlocks: string[] = [];
    await expect(
      getArgentMultisigConfig({
        address: ADDRESS,
        makeProvider: makeProvider({
          readBlocks,
          responses: {
            get_signer_guids: ["0x2", GUID_A, GUID_B],
            get_threshold: ["0x2"],
          },
        }),
        rpcUrls: RPC_URLS,
      }),
    ).resolves.toEqual({
      classHash: ARGENT_MULTISIG_CONTRACT.classHash,
      signerGuids: [GUID_A, GUID_B],
      threshold: 2,
    });
    expect(readBlocks).toEqual([BLOCK_HASH, BLOCK_HASH, BLOCK_HASH]);
  });

  test("rejects a contract whose class is not the stable pin", async () => {
    await expect(
      getArgentMultisigConfig({
        address: ADDRESS,
        makeProvider: makeProvider({
          classHash: "0x123",
          responses: {
            get_signer_guids: ["0x2", GUID_A, GUID_B],
            get_threshold: ["0x2"],
          },
        }),
        rpcUrls: RPC_URLS,
      }),
    ).rejects.toThrow("not the pinned Argent Multisig 0.2 class");
  });

  test("rejects malformed threshold and signer responses", async () => {
    for (const responses of [
      { get_threshold: [] },
      { get_threshold: ["0x0"] },
      { get_signer_guids: ["0x2", GUID_A] },
      { get_signer_guids: ["0x2", GUID_A, GUID_A] },
      { get_signer_guids: ["0x1", "0x0"], get_threshold: ["0x1"] },
    ]) {
      await expect(
        getArgentMultisigConfig({
          address: ADDRESS,
          makeProvider: validProvider(responses),
          rpcUrls: RPC_URLS,
        }),
      ).rejects.toThrow("Invalid Argent multisig");
    }
  });

  test("canonicalizes valid on-chain linked-list order after config changes", async () => {
    await expect(
      getArgentMultisigConfig({
        address: ADDRESS,
        makeProvider: validProvider({ get_signer_guids: ["0x2", GUID_B, GUID_A] }),
        rpcUrls: RPC_URLS,
      }),
    ).resolves.toMatchObject({ signerGuids: [GUID_A, GUID_B] });
  });

  test("turns a timeout into an actionable read failure", async () => {
    const timeout = new Error("aborted due to timeout");
    timeout.name = "TimeoutError";
    await expect(
      getArgentMultisigConfig({
        address: ADDRESS,
        makeProvider: makeProvider({ thrown: timeout }),
        rpcUrls: RPC_URLS,
      }),
    ).rejects.toThrow("verification took too long");
  });
});

describe("getArgentMultisigSignerPublicKeys", () => {
  test("recovers and verifies current Stark signer keys from linked events", async () => {
    const publicKeys = ["0x123", "0x456"];
    const signerGuids = publicKeys
      .map(argentSignerGuid)
      .sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : 1));
    const eventFilters: unknown[] = [];
    const eventFor = (publicKey: string) => ({
      block_hash: BLOCK_HASH,
      block_number: 100,
      data: ["0x0", publicKey],
      from_address: ADDRESS,
      keys: ["0x1", argentSignerGuid(publicKey)],
      transaction_hash: "0x789",
    });
    const provider = {
      async getBlockLatestAccepted() {
        return { block_hash: BLOCK_HASH, block_number: 123 };
      },
      async getClassHashAt(_address: string, blockIdentifier?: number) {
        if (typeof blockIdentifier === "number" && blockIdentifier < 100) {
          throw new Error("Contract not found");
        }
        return ARGENT_MULTISIG_CONTRACT.classHash;
      },
      async getEvents(filter: unknown) {
        eventFilters.push(filter);
        return { events: publicKeys.map(eventFor) };
      },
    } as unknown as RpcProvider;

    const expectedKeys = [...publicKeys].sort((left, right) =>
      BigInt(argentSignerGuid(left)) < BigInt(argentSignerGuid(right)) ? -1 : 1,
    );
    await expect(
      getArgentMultisigSignerPublicKeys({
        address: ADDRESS,
        makeProvider: () => provider,
        rpcUrls: RPC_URLS,
        signerGuids,
      }),
    ).resolves.toEqual({ signerPublicKeys: expectedKeys, unsupportedSigners: [] });
    expect(eventFilters).toHaveLength(1);
    expect(eventFilters[0]).toMatchObject({
      address: ADDRESS,
      from_block: { block_number: 100 },
      to_block: { block_hash: BLOCK_HASH },
    });
  });

  test("rejects a linked Stark key that does not derive to its event GUID", async () => {
    const provider = {
      async getBlockLatestAccepted() {
        return { block_hash: BLOCK_HASH, block_number: 1 };
      },
      async getClassHashAt() {
        return ARGENT_MULTISIG_CONTRACT.classHash;
      },
      async getEvents() {
        return {
          events: [
            {
              block_hash: BLOCK_HASH,
              block_number: 1,
              data: ["0x0", "0x456"],
              from_address: ADDRESS,
              keys: ["0x1", argentSignerGuid("0x123")],
              transaction_hash: "0x789",
            },
          ],
        };
      },
    } as unknown as RpcProvider;
    await expect(
      getArgentMultisigSignerPublicKeys({
        address: ADDRESS,
        makeProvider: () => provider,
        rpcUrls: RPC_URLS,
        signerGuids: [argentSignerGuid("0x123")],
      }),
    ).rejects.toThrow("Invalid Argent multisig signer event");
  });

  test("classifies supported non-Stark signer schemes without requesting Stark keys", async () => {
    const signerGuids = ["0x123", "0x456"];
    const provider = {
      async getBlockLatestAccepted() {
        return { block_hash: BLOCK_HASH, block_number: 1 };
      },
      async getClassHashAt() {
        return ARGENT_MULTISIG_CONTRACT.classHash;
      },
      async getEvents() {
        return {
          events: signerGuids.map((guid, index) => ({
            block_hash: BLOCK_HASH,
            block_number: 1,
            data: [index === 0 ? "0x2" : "0x4"],
            from_address: ADDRESS,
            keys: ["0x1", guid],
            transaction_hash: "0x789",
          })),
        };
      },
    } as unknown as RpcProvider;

    await expect(
      getArgentMultisigSignerPublicKeys({
        address: ADDRESS,
        makeProvider: () => provider,
        rpcUrls: RPC_URLS,
        signerGuids,
      }),
    ).resolves.toEqual({
      signerPublicKeys: [],
      unsupportedSigners: [
        { guid: "0x123", type: "secp256r1" },
        { guid: "0x456", type: "webauthn" },
      ],
    });
  });
});

describe("isArgentMultisigSignerGuid", () => {
  test("returns the contract's exact membership bit", async () => {
    for (const [felt, expected] of [
      ["0x0", false],
      ["0x1", true],
    ] as const) {
      await expect(
        isArgentMultisigSignerGuid({
          address: ADDRESS,
          makeProvider: validProvider({ is_signer_guid: [felt] }),
          rpcUrls: RPC_URLS,
          signerGuid: GUID_A,
        }),
      ).resolves.toBe(expected);
    }
  });

  test("rejects a malformed membership result", async () => {
    await expect(
      isArgentMultisigSignerGuid({
        address: ADDRESS,
        makeProvider: validProvider({ is_signer_guid: ["0x2"] }),
        rpcUrls: RPC_URLS,
        signerGuid: GUID_A,
      }),
    ).rejects.toThrow("Invalid Argent multisig signer membership response");
  });
});
