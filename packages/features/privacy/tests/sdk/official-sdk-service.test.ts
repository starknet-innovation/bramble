/**
 * Official privacy-SDK adapter tests. The SDK is injected as a deterministic
 * protocol double so response validation and secret-routing invariants do not
 * depend on live prover, discovery, or chain services.
 */
import { describe, expect, test } from "bun:test";
import {
  createOfficialStrk20Service,
  type PrivacySdkRuntime,
} from "@bramble/privacy/official-sdk-service";
import type { Strk20Action } from "@bramble/wallet-protocol/strk20";
import {
  officialBuilder as builder,
  STRK20_SDK_CONTEXT as context,
  executeResult,
  STRK20_POOL_ADDRESS as poolAddress,
  providerFor,
  sdkRuntime as runtime,
  STRK20_SDK_TOKEN as token,
} from "../support/official-sdk";

describe("official STRK20 SDK adapter", () => {
  test("routes the vault-only viewing key into discovery and preserves requested token order", async () => {
    let seenViewingKey = "";
    const sdk = runtime((input) => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        seenViewingKey = await input.viewingKeyProvider.getViewingKey();
        return {
          notes: new Map([
            [BigInt(token), [{ amount: 2n }, { amount: 3n }]],
            [0x999n, [{ amount: 7n }]],
          ]),
        };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });
    await expect(
      service.privateBalances({ ...context, tokens: ["0x999", token] }),
    ).resolves.toEqual([
      { balance: "0x7", token: "0x999" },
      { balance: "0x5", token },
    ]);
    expect(seenViewingKey).toBe("0x55");
  });

  test("maps a simulated SDK call and canonical empty proof", async () => {
    const sdk = runtime(() => ({
      build: () =>
        builder({
          callAndProof: {
            call: { calldata: ["0x1"], contractAddress: poolAddress, entrypoint: "apply_actions" },
            proof: { data: "", output: [], proofFacts: [] },
          },
          warnings: [],
        }),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });
    await expect(
      service.prepare({
        ...context,
        actions: [{ amount: "0x1", recipient: "0x999", token, type: "withdraw" }],
        simulate: true,
      }),
    ).resolves.toEqual({
      call: { calldata: ["0x1"], contract_address: poolAddress, entry_point: "apply_actions" },
      proof: { data: "", output: [], proof_facts: [] },
    });
  });

  test("maps every wallet action into the official builder without changing semantics", async () => {
    const seen: unknown[] = [];
    const open = Symbol("OPEN");
    const sdk: PrivacySdkRuntime = {
      Open: open,
      createPrivateTransfers: () => {
        const self = {
          createProofInvocation: async () => ({ warnings: [] }),
          invoke(callback: (args: unknown) => unknown) {
            seen.push([
              "invoke",
              callback({
                openNotes: [{ noteId: "0x42" }],
                poolAddress,
              }),
            ]);
            return self;
          },
          simulate: async () => ({
            ...executeResult(),
            callAndProof: {
              call: {
                calldata: ["0x1"],
                contractAddress: poolAddress,
                entrypoint: "apply_actions",
              },
              proof: { data: "", output: [], proofFacts: [] },
            },
          }),
          surplusTo(recipient: string, withdraw?: boolean) {
            seen.push(["surplusTo", recipient, withdraw]);
            return self;
          },
          subaccounts(dappName: string) {
            return {
              commitment: async () => 0x123n,
              invoke(nonce: string, options: unknown) {
                seen.push(["subaccount", dappName, nonce, options]);
                return self;
              },
              partialCommitment: async () => 0x456n,
            };
          },
          with(selectedToken: string) {
            const tokenBuilder = {
              deposit(...inputs: readonly unknown[]) {
                seen.push(["deposit", selectedToken, inputs]);
                return tokenBuilder;
              },
              done: () => self,
              transfer(...outputs: readonly unknown[]) {
                seen.push(["transfer", selectedToken, outputs]);
                return tokenBuilder;
              },
              withdraw(...outputs: readonly unknown[]) {
                seen.push(["withdraw", selectedToken, outputs]);
                return tokenBuilder;
              },
            };
            return tokenBuilder;
          },
        };
        return {
          build: () => self,
          discoverNotes: async () => ({ notes: new Map() }),
          executeWithInvocation: async () => executeResult(),
        } as unknown as ReturnType<PrivacySdkRuntime["createPrivateTransfers"]>;
      },
    };
    const actions: readonly Strk20Action[] = [
      { amount: "0x2", token, type: "deposit" },
      { amount: "0x6", recipient: "0x997", token, type: "deposit" },
      { amount: "0x3", recipient: "0x999", token, type: "withdraw" },
      { amount: "OPEN", recipient: "0x998", token, type: "transfer" },
      {
        calls: [{ calldata: ["0x1"], contract_address: token, entry_point: "transfer" }],
        collect_policy: { amount: "0x4", type: "exact" },
        dapp_name: "vesu",
        nonce: "0x5",
        type: "subaccount_invoke",
      },
      {
        calldata: [`${"$"}{poolAddress}`, `${"$"}{openNoteIds[0]}`, "literal"],
        contract: "0x777",
        type: "invoke",
      },
    ];

    await createOfficialStrk20Service({ providerFor, sdk }).prepare({
      ...context,
      actions,
      simulate: true,
    });

    expect(seen).toEqual([
      // A bare deposit passes no recipient key at all, so the SDK credits the
      // depositor through the batch's implicit surplus; a named one is forwarded.
      ["deposit", token, [{ amount: 2n }]],
      ["deposit", token, [{ amount: 6n, recipient: "0x997" }]],
      ["withdraw", token, [{ amount: 3n, recipient: "0x999" }]],
      ["transfer", token, [{ amount: open, recipient: "0x998" }]],
      [
        "subaccount",
        "vesu",
        "0x5",
        {
          calls: [{ calldata: ["0x1"], contractAddress: token, entrypoint: "transfer" }],
          collectPolicy: { amount: 4n, type: "exact" },
        },
      ],
      ["invoke", { calldata: [poolAddress, "0x42", "literal"], contractAddress: "0x777" }],
      ["surplusTo", context.account.address, false],
    ]);
  });

  test("returns sorted discovered balances and rejects malformed note amounts", async () => {
    let notes: Map<bigint, readonly { readonly amount: bigint }[]> = new Map([
      [0x999n, [{ amount: 7n }]],
      [BigInt(token), [{ amount: 5n }]],
    ]);
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });

    await expect(service.privateBalances({ ...context, tokens: [] })).resolves.toEqual([
      { balance: "0x5", token },
      { balance: "0x7", token: "0x999" },
    ]);
    notes = new Map([[0x999n, [{ amount: -1n }]]]);
    await expect(service.privateBalances({ ...context, tokens: [] })).rejects.toThrow(
      "strk20 services unavailable",
    );
  });

  test("bounds untrusted discovery output before aggregation", async () => {
    let notes: Map<bigint, readonly { readonly amount: bigint }[]> = new Map([
      [BigInt(token), Array.from({ length: 4_097 }, () => ({ amount: 1n }))],
    ]);
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });
    await expect(service.privateBalances({ ...context, tokens: [] })).rejects.toThrow(
      "strk20 services unavailable",
    );
    notes = new Map(
      Array.from({ length: 65 }, (_, index) => [BigInt(index + 1), [{ amount: 1n }]]),
    );
    await expect(service.privateBalances({ ...context, tokens: [] })).rejects.toThrow(
      "strk20 services unavailable",
    );
  });

  test("uses OHTTP for both services and keeps anonymizers dapp-specific", async () => {
    class DiscoveryProvider {
      constructor(
        readonly url: string,
        readonly pool: string,
        readonly options: unknown,
      ) {}
    }
    let sdkInput: Record<string, unknown> | null = null;
    const sdk: PrivacySdkRuntime = {
      ...runtime(() => ({
        build: () => builder(executeResult()),
        discoverNotes: async () => ({ notes: new Map() }),
        executeWithInvocation: async () => executeResult(),
      })),
      IndexerDiscoveryProvider: DiscoveryProvider,
      createPrivateTransfers(input) {
        sdkInput = input as Record<string, unknown>;
        return {
          build: () => builder(executeResult()),
          discoverNotes: async () => ({ notes: new Map() }),
          executeWithInvocation: async () => executeResult(),
        };
      },
    };
    const privateContext = {
      ...context,
      config: {
        discoveryUrl: "https://gateway.example/discovery",
        ohttpEnabled: true,
        poolAddress,
        proverUrl: "https://gateway.example/prover",
      },
    };
    const service = createOfficialStrk20Service({ providerFor, sdk });

    await expect(service.privateBalances({ ...privateContext, tokens: [] })).resolves.toEqual([]);
    expect(sdkInput?.["discoveryProvider"]).toBeInstanceOf(DiscoveryProvider);
    expect(sdkInput?.["provingProvider"]).toMatchObject({ ohttp: true });
    expect(sdkInput).not.toHaveProperty("subAccountAnonymizerAddress");
    await expect(
      service.subaccountCommitment({ ...privateContext, dappName: "vesu" }),
    ).rejects.toThrow("strk20 services unavailable");
    await expect(
      service.prepare({
        ...privateContext,
        actions: [
          {
            calls: [{ calldata: [], contract_address: token, entry_point: "transfer" }],
            collect_policy: { type: "all" },
            dapp_name: "vesu",
            nonce: "0x1",
            type: "subaccount_invoke",
          },
        ],
        simulate: true,
      }),
    ).rejects.toThrow("strk20 services unavailable");
  });

  test("prepares a proof and derives both forms of subaccount commitment", async () => {
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        return { notes: new Map() };
      },
      executeWithInvocation: async () => executeResult(),
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });

    await expect(
      service.prepare({
        ...context,
        actions: [{ amount: "0x1", token, type: "deposit" }],
        simulate: false,
      }),
    ).resolves.toEqual({
      call: { calldata: ["0x1"], contract_address: poolAddress, entry_point: "apply_actions" },
      proof: { data: "proof", output: ["0x1"], proof_facts: ["0x2"] },
    });
    await expect(service.subaccountCommitment({ ...context, dappName: "vesu" })).resolves.toBe(
      "0x456",
    );
    await expect(
      service.subaccountCommitment({ ...context, dappName: "vesu", nonce: "0x1" }),
    ).resolves.toBe("0x123");
  });

  test("blocks USER_LINKAGE before sending a proof request", async () => {
    let proved = false;
    const linkedBuilder = builder(executeResult(), {
      warnings: [{ code: "USER_LINKAGE", message: "multiple channels" }],
    });
    const sdk = runtime(() => ({
      build: () => linkedBuilder,
      async discoverNotes() {
        return { notes: new Map() };
      },
      async executeWithInvocation() {
        proved = true;
        return executeResult();
      },
    }));
    const service = createOfficialStrk20Service({ providerFor, sdk });
    await expect(
      service.prepare({
        ...context,
        actions: [{ amount: "0x1", recipient: "0x999", token, type: "withdraw" }],
        simulate: false,
      }),
    ).rejects.toThrow("strk20 privacy leak");
    expect(proved).toBe(false);
  });

  test("fails closed on unknown or malformed SDK warnings", async () => {
    for (const warningResult of [
      { warnings: [{ code: "UNKNOWN", message: "review me" }] },
      {
        warnings: Array.from({ length: 65 }, () => ({ code: "", message: "" })),
      },
      { warnings: "not-an-array" },
      {},
    ]) {
      const sdk = runtime(() => ({
        build: () => builder(warningResult),
        async discoverNotes() {
          return { notes: new Map() };
        },
        executeWithInvocation: async () => executeResult(),
      }));
      await expect(
        createOfficialStrk20Service({ providerFor, sdk }).prepare({
          ...context,
          actions: [{ amount: "0x1", recipient: "0x999", token, type: "withdraw" }],
          simulate: true,
        }),
      ).rejects.toThrow("strk20 services unavailable");
    }
  });

  test("rejects an SDK result targeting another contract or entry point", async () => {
    for (const call of [
      { calldata: ["0x1"], contractAddress: "0x999", entrypoint: "apply_actions" },
      { calldata: ["0x1"], contractAddress: poolAddress, entrypoint: "transfer" },
    ]) {
      const sdk = runtime(() => ({
        build: () =>
          builder({
            callAndProof: {
              call,
              proof: { data: "", output: [], proofFacts: [] },
            },
            warnings: [],
          }),
        async discoverNotes() {
          return { notes: new Map() };
        },
        executeWithInvocation: async () => executeResult(),
      }));
      await expect(
        createOfficialStrk20Service({ providerFor, sdk }).prepare({
          ...context,
          actions: [{ amount: "0x1", recipient: "0x999", token, type: "withdraw" }],
          simulate: true,
        }),
      ).rejects.toThrow("strk20 services unavailable");
    }
  });

  test("maps SDK insufficient-note failures to the stable wallet error", async () => {
    const sdk = runtime(() => ({
      build: () => builder(executeResult()),
      async discoverNotes() {
        throw new Error("not enough private notes");
      },
      executeWithInvocation: async () => executeResult(),
    }));
    await expect(
      createOfficialStrk20Service({ providerFor, sdk }).privateBalances({
        ...context,
        tokens: [token],
      }),
    ).rejects.toThrow("insufficient private balance");
  });
});
