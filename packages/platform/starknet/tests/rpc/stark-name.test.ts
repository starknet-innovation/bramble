/**
 * Starknet ID name resolution: turns a typed `name.stark` into the account
 * address it points at. Covers the resolved / not-found / unsupported-network /
 * unreachable outcomes, the contract-not-found answer, failover past a
 * malfunctioning endpoint, the exact naming-contract calldata the library
 * encoder produces, and name normalization.
 */
import { describe, expect, test } from "bun:test";
import { WalletError } from "@bramble/core/errors";
import {
  normalizeStarkName,
  resolveStarkName,
  type StarkNameResolution,
} from "@bramble/starknet/stark-name";
import type { RpcProvider } from "starknet";

const RPC_URLS = ["https://node.example/rpc"];

// A real registered Starknet ID name and the address the naming contract
// answered for it on mainnet (verified 2026-10-03). Its calldata is the decimal
// felts `useEncoded` produces, wrapped by `CallData.compile`.
const KNOWN_NAME = "fricoben.stark";
const KNOWN_LABEL_ENCODED = "1499554868251";
const KNOWN_CALLDATA = ["1", KNOWN_LABEL_ENCODED, "0"];
const KNOWN_ADDRESS = "0x61b6c0a78f9edf13cea17b50719f3344533fadd470b8cb29c2b4318014f52d3";

type ProviderStub = {
  readonly getChainId?: () => Promise<string>;
  readonly callContract?: (call: {
    readonly calldata: readonly string[];
    readonly contractAddress: string;
    readonly entrypoint: string;
  }) => Promise<readonly string[]>;
};

const providerWith = (stub: ProviderStub): ((nodeUrl: string) => RpcProvider) => {
  return () =>
    ({
      getChainId: stub.getChainId ?? (async () => "0x534e5f4d41494e"),
      callContract: stub.callContract ?? (async () => [KNOWN_ADDRESS]),
    }) as unknown as RpcProvider;
};

const resolve = (
  makeProvider: (nodeUrl: string) => RpcProvider,
  name = KNOWN_NAME,
): Promise<StarkNameResolution> => resolveStarkName({ makeProvider, name, rpcUrls: RPC_URLS });

describe("normalizeStarkName", () => {
  test("adds the .stark suffix and lower-cases the typed name", () => {
    expect(normalizeStarkName("Fricoben")).toBe("fricoben.stark");
    expect(normalizeStarkName("  Fricoben.STARK ")).toBe("fricoben.stark");
  });

  test("keeps a multi-label name and rejects anything that is not a Starknet name", () => {
    expect(normalizeStarkName("altaga.braavos.stark")).toBe("altaga.braavos.stark");
    expect(normalizeStarkName("")).toBeNull();
    expect(normalizeStarkName(".stark")).toBeNull();
    expect(normalizeStarkName("has space.stark")).toBeNull();
    // A full-length hex address is far past the 48-character label limit, so it
    // is not read as a name.
    expect(normalizeStarkName(`0x${"a".repeat(64)}`)).toBeNull();
  });
});

describe("resolveStarkName", () => {
  test("resolves to the naming contract's nonzero address", async () => {
    const result = await resolve(providerWith({}));
    expect(result).toEqual({ address: KNOWN_ADDRESS, status: "resolved" });
  });

  test("sends the library-encoded domain to domain_to_address on the pinned contract", async () => {
    const calls: unknown[] = [];
    await resolve(
      providerWith({
        async callContract(call) {
          calls.push(call);
          return [KNOWN_ADDRESS];
        },
      }),
    );
    expect(calls).toEqual([
      {
        calldata: KNOWN_CALLDATA,
        contractAddress: "0x6ac597f8116f886fa1c97a23fa4e08299975ecaf6b598873ca6792b9bbfb678",
        entrypoint: "domain_to_address",
      },
    ]);
  });

  test("encodes each label of a multi-label name as its own felt", async () => {
    // The calldata for `altaga.braavos.stark` (verified 2026-10-03): length
    // prefix, one felt per label, then the hint array length. Pins the
    // label-splitting path, not just the single-label one.
    const calls: unknown[] = [];
    await resolve(
      providerWith({
        async callContract(call) {
          calls.push(call);
          return [KNOWN_ADDRESS];
        },
      }),
      "altaga.braavos.stark",
    );
    expect(calls).toEqual([
      {
        calldata: ["2", "2944239886", "55349935767", "0"],
        contractAddress: "0x6ac597f8116f886fa1c97a23fa4e08299975ecaf6b598873ca6792b9bbfb678",
        entrypoint: "domain_to_address",
      },
    ]);
  });

  test("maps the contract's zero answer to not-found", async () => {
    for (const zero of [["0x0"], ["0x00"], ["0"]]) {
      const result = await resolve(providerWith({ callContract: async () => zero }));
      expect(result).toEqual({ status: "not-found" });
    }
  });

  test("fails over past a non-felt answer to a working endpoint", async () => {
    let call = 0;
    const result = await resolveStarkName({
      makeProvider: () =>
        ({
          async getChainId() {
            return "0x534e5f4d41494e";
          },
          async callContract() {
            call += 1;
            return call === 1 ? ["not-a-felt"] : [KNOWN_ADDRESS];
          },
        }) as unknown as RpcProvider,
      name: KNOWN_NAME,
      rpcUrls: ["https://bad.example/rpc", "https://good.example/rpc"],
    });
    expect(result).toEqual({ address: KNOWN_ADDRESS, status: "resolved" });
    expect(call).toBe(2);
  });

  test("returns unreachable when every endpoint fails at the transport level", async () => {
    const result = await resolve(
      providerWith({
        async callContract() {
          throw new Error("fetch failed: ECONNREFUSED");
        },
      }),
    );
    expect(result).toEqual({ status: "unreachable" });
  });

  test("returns unsupported-network when the chain has no Starknet ID deployment", async () => {
    let called = false;
    const result = await resolve(
      providerWith({
        async callContract() {
          called = true;
          return [KNOWN_ADDRESS];
        },
        async getChainId() {
          return "0x1";
        },
      }),
    );
    expect(result).toEqual({ status: "unsupported-network" });
    expect(called).toBe(false);
  });

  test("returns unsupported-network when the naming contract is absent", async () => {
    const error = new Error("Contract not found") as Error & { baseError?: { code: number } };
    error.baseError = { code: 20 };
    const result = await resolve(
      providerWith({
        async callContract() {
          throw error;
        },
      }),
    );
    expect(result).toEqual({ status: "unsupported-network" });
  });

  test("rejects an invalid name before any RPC call", async () => {
    let called = false;
    await expect(
      resolve(
        providerWith({
          async callContract() {
            called = true;
            return [KNOWN_ADDRESS];
          },
        }),
        "not a name",
      ),
    ).rejects.toBeInstanceOf(WalletError);
    expect(called).toBe(false);
  });

  test("propagates an unexpected semantic RPC error rather than faking a result", async () => {
    await expect(
      resolve(
        providerWith({
          async callContract() {
            const error = new Error("unexpected node error") as Error & {
              baseError?: { code: number };
            };
            error.baseError = { code: 99 };
            throw error;
          },
        }),
      ),
    ).rejects.toThrow("unexpected node error");
  });
});
