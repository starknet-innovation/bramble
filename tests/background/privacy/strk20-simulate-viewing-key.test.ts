/**
 * An approved dapp `wallet_strk20PrepareInvoke` with `simulate: true` must not
 * send the account's viewing key to the user's RPC override.
 *
 * Drives the real background router, approval flow, and official-SDK adapter
 * with an RPC override set, over an SDK double whose `simulate` behaves like
 * the pinned SDK's (a `compile_actions` view call carrying the viewing key to
 * the provider it is given). The override's provider must see no such call.
 */
import { describe, expect, test } from "bun:test";
import { createOfficialStrk20Service } from "@bramble/privacy/official-sdk-service";
import { defaultWalletPreferences, type WalletPreferences } from "@bramble/settings/preferences";
import type { RpcProvider } from "starknet";
import {
  executeResult,
  sdkRuntime,
  strk20ProviderFor,
} from "../../../packages/features/privacy/tests/support/official-sdk";
import {
  approveHeldStrk20,
  buildStrk20Handler,
  STRK20_ORIGIN,
  STRK20_RECIPIENT,
  STRK20_TOKEN,
} from "../../support/strk20-background";

const OVERRIDE = "https://rpc-override.example/rpc";
const VIEWING_KEY_MARKER = "compile_actions";

const mainnetStrk20 = () => {
  const mainnet = defaultWalletPreferences().strk20Networks?.SN_MAIN;
  if (!mainnet) {
    throw new Error("missing default STRK20 test config");
  }
  return mainnet;
};

// A prover result bound to the configured pool's `apply_actions`.
const proofResult = () => {
  const result = executeResult();
  return {
    ...result,
    callAndProof: {
      ...result.callAndProof,
      call: { ...result.callAndProof.call, contractAddress: mainnetStrk20().poolAddress },
    },
  };
};

const preferences = (): WalletPreferences => {
  const defaults = defaultWalletPreferences();
  const mainnet = mainnetStrk20();
  return {
    ...defaults,
    activeNetworkId: "SN_SEPOLIA",
    rpcOverrides: { SN_SEPOLIA: OVERRIDE },
    strk20Networks: { ...defaults.strk20Networks, SN_SEPOLIA: mainnet },
  };
};

describe("dapp STRK20 simulation with an RPC override", () => {
  test("the override node never receives the compile_actions invocation", async () => {
    const seen: { readonly entrypoint: string; readonly url: string }[] = [];
    const proofs = { value: 0 };
    const base = strk20ProviderFor();
    const nodes: string[] = [];
    const providerFor = (url: string): RpcProvider => {
      nodes.push(url);
      const provider = base();
      return {
        ...provider,
        async callContract(call: { entrypoint?: string }) {
          seen.push({ entrypoint: call.entrypoint ?? "", url });
          return provider.callContract(call as never);
        },
      } as unknown as RpcProvider;
    };
    // Self-referential like the SDK's builder, so the chain the adapter walks
    // ends on the same object whose `simulate` mirrors the pinned SDK: a view
    // call of the viewing-key-bearing invocation through the given provider.
    const builder = {
      createProofInvocation: async () => ({ warnings: [] }),
      invoke: () => builder,
      async simulate(options: { readonly provider: RpcProvider }) {
        await options.provider.callContract({
          calldata: ["0xabc", "0x55"],
          contractAddress: "0xabc",
          entrypoint: VIEWING_KEY_MARKER,
        });
        return proofResult();
      },
      surplusTo: () => builder,
      with: () => ({ done: () => builder, transfer: () => ({ done: () => builder }) }),
    };
    const sdk = sdkRuntime(() => ({
      build: () => builder as never,
      discoverNotes: async () => ({ notes: new Map([[BigInt(STRK20_TOKEN), [{ amount: 5n }]]]) }),
      discoverRequirement: async () => 3,
      async executeWithInvocation() {
        proofs.value += 1;
        return proofResult();
      },
    }));
    const handler = buildStrk20Handler({
      preferences: preferences(),
      strk20: createOfficialStrk20Service({ providerFor, sdk }),
    });

    const result = await approveHeldStrk20(
      handler,
      {
        actions: [
          { amount: "0x1", recipient: STRK20_RECIPIENT, token: STRK20_TOKEN, type: "transfer" },
        ],
        origin: STRK20_ORIGIN,
        simulate: true,
        type: "wallet.strk20PrepareInvoke",
      },
      "strk20-prepare",
    );

    expect(seen.filter((call) => call.entrypoint === VIEWING_KEY_MARKER)).toEqual([]);
    expect(result).toMatchObject({
      callAndProof: { proof: { data: "", output: [], proof_facts: [] } },
      ok: true,
    });
    expect(proofs.value).toBe(1);
    // The adapter did hand the SDK the override node: it is the one at risk.
    expect(nodes).toContain(OVERRIDE);
  });
});
