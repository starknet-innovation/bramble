/**
 * Approval queue checks prove dapp connection prompts are explicit and removable.
 */
import { describe, expect, test } from "bun:test";
import { createApprovalQueue, MAX_PENDING_APPROVALS } from "../../src/background/approvals";

const CONTEXT = {
  accountId: "SN_MAIN:0x1",
  chainId: "0x534e5f4d41494e",
  networkId: "SN_MAIN" as const,
  payloadDigest: `sha256:${"a".repeat(64)}`,
};

const DECLARATION = {
  abiEntryCount: 1,
  accountDeployment: "deployed" as const,
  classHash: "0x2",
  compiledClassHash: "0x1",
  deploymentFee: null,
  deploymentFeeEstimateFailed: false,
  entryPointCount: 1,
  fee: { overallFee: "1000", unit: "FRI" },
  feeEstimateFailed: false,
  sierraProgramLength: 1,
};

describe("createApprovalQueue", () => {
  test("deduplicates requests by origin", () => {
    const queue = createApprovalQueue();
    const first = queue.request("https://example.com");
    const second = queue.request("https://example.com");

    expect(second).toEqual(first);
    expect(queue.list()).toEqual([first]);
  });

  test("rejects invalid origins", () => {
    const queue = createApprovalQueue();

    expect(() => queue.request("http://example.com")).toThrow("Invalid origin");
    expect(queue.list()).toEqual([]);
  });

  test("removes approved and denied requests", () => {
    const queue = createApprovalQueue();
    const approved = queue.request("https://approve.example");
    const denied = queue.request("https://deny.example");

    expect(queue.approve("not-a-uuid")).toBeNull();
    expect(queue.approve(approved.id)).toEqual(approved);
    expect(queue.deny(denied.id)).toEqual(denied);
    expect(queue.list()).toEqual([]);
  });

  test("returns snapshots instead of mutable queue state", () => {
    const queue = createApprovalQueue();
    const approval = queue.request("https://example.com");
    const returned = approval as { origin: string };
    const listed = queue.list()[0] as { origin: string };
    const peeked = queue.get(approval.id) as { origin: string };

    returned.origin = "https://changed.example";
    listed.origin = "https://listed.example";
    peeked.origin = "https://peeked.example";

    expect(queue.list()).toEqual([
      { id: approval.id, kind: "connect", origin: "https://example.com" },
    ]);
  });

  test("caps pending approvals without breaking origin deduplication", () => {
    const queue = createApprovalQueue();
    const first = queue.request("https://app-0.example");

    for (let index = 1; index < MAX_PENDING_APPROVALS; index += 1) {
      queue.request(`https://app-${index}.example`);
    }

    expect(queue.request("https://app-0.example")).toEqual(first);
    expect(() => queue.request("https://overflow.example")).toThrow("Too many pending approvals");
    expect(queue.list()).toHaveLength(MAX_PENDING_APPROVALS);
  });

  test("queues watch-asset prompts per origin and token", () => {
    const queue = createApprovalQueue();
    const token = {
      address: "0x1",
      decimals: 18,
      name: "Test Token",
      networkId: "SN_MAIN" as const,
      symbol: "TST",
    };
    const other = { ...token, address: "0x2", symbol: "OTH" };

    const first = queue.requestWatchAsset({ origin: "https://example.com", token });
    const repeat = queue.requestWatchAsset({ origin: "https://example.com", token });
    const second = queue.requestWatchAsset({ origin: "https://example.com", token: other });

    expect(first.kind).toBe("watch-asset");
    expect(first.token).toEqual(token);
    expect(repeat).toEqual(first);
    expect(second.id).not.toBe(first.id);
    expect(queue.list()).toHaveLength(2);
  });

  test("keeps watch-asset snapshots isolated from queue state", () => {
    const queue = createApprovalQueue();
    const approval = queue.requestWatchAsset({
      origin: "https://example.com",
      token: {
        address: "0x1",
        decimals: 18,
        name: "Test Token",
        networkId: "SN_MAIN",
        symbol: "TST",
      },
    });
    (approval.token as { symbol: string }).symbol = "HACK";

    expect(queue.get(approval.id)?.token?.symbol).toBe("TST");
  });

  test("rejects watch-asset requests from invalid origins", () => {
    const queue = createApprovalQueue();

    expect(() =>
      queue.requestWatchAsset({
        origin: "http://example.com",
        token: {
          address: "0x1",
          decimals: 18,
          name: "Test Token",
          networkId: "SN_MAIN",
          symbol: "TST",
        },
      }),
    ).toThrow("Invalid origin");
  });
});

// Directly exercises the private payload discriminator: each request kind that
// carries execution data reconstructs its own payload shape, connection prompts
// have none, and a non-uuid / unknown id resolves to null.
describe("createApprovalQueue payload discrimination", () => {
  const ORIGIN = "https://payload.example";

  test("returns null for a connection prompt (no execution payload)", () => {
    const queue = createApprovalQueue();
    const { id } = queue.request(ORIGIN);
    expect(queue.payload(id)).toBeNull();
  });

  test("returns null for a non-uuid or unknown id", () => {
    const queue = createApprovalQueue();
    expect(queue.payload("not-a-uuid")).toBeNull();
    expect(queue.payload(crypto.randomUUID())).toBeNull();
  });

  test("reconstructs typed data for a sign-typed-data prompt", () => {
    const queue = createApprovalQueue();
    const typedData = { domain: {}, message: { a: 1 }, primaryType: "X", types: {} };
    const { id } = queue.requestSignTypedData({
      context: CONTEXT,
      origin: ORIGIN,
      summary: "Sign",
      typedData,
    });
    expect(queue.payload(id)).toEqual({ typedData });
  });

  test("reconstructs the switch-chain target before the chain/declare branches", () => {
    const queue = createApprovalQueue();
    const { id } = queue.requestSwitchChain({
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN",
      origin: ORIGIN,
      summary: "Switch",
    });
    expect(queue.payload(id)).toEqual({ chainId: "0x534e5f4d41494e", networkId: "SN_MAIN" });
  });

  test("reconstructs an add-chain payload", () => {
    const queue = createApprovalQueue();
    const chain = { chainId: "0x1", chainName: "Custom" } as never;
    const { id } = queue.requestAddChain({ chain, origin: ORIGIN, summaries: ["Add"] });
    expect(queue.payload(id)).toEqual({ chain });
  });

  test("reconstructs a declare payload", () => {
    const queue = createApprovalQueue();
    const declare = { compiledClassHash: "0x1", contract: {} } as never;
    const { id } = queue.requestDeclare({
      context: CONTEXT,
      declare,
      declaration: DECLARATION,
      origin: ORIGIN,
      summaries: ["Declare"],
    });
    expect(queue.payload(id)).toEqual({ declare });
  });

  test("reconstructs strk20 actions", () => {
    const queue = createApprovalQueue();
    const actions = [{ amount: "1", kind: "transfer", to: "0x2", token: "0x3" }] as never;
    const calls = [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "execute" }];
    const { id } = queue.requestStrk20Invoke({
      actions,
      calls,
      context: CONTEXT,
      origin: ORIGIN,
      summaries: ["Send"],
    });
    expect(queue.payload(id)).toEqual({ actions, calls });
  });

  test("reconstructs deep-cloned invoke calls", () => {
    const queue = createApprovalQueue();
    const calls = [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "transfer" }];
    const { id } = queue.requestInvoke({
      fee: { fee: null, feeEstimateFailed: false, requiresDeployment: false },
      calls,
      context: CONTEXT,
      flags: [],
      origin: ORIGIN,
      summaries: ["Invoke"],
    });
    const payload = queue.payload(id);

    expect(payload).toEqual({ calls });
    // The reconstructed calldata is a fresh array, not the caller's reference.
    (payload?.calls?.[0]?.calldata as string[])[0] = "0xdead";
    expect(queue.payload(id)).toEqual({ calls });
  });
});

// The per-kind request builders each reject a non-wallet origin, and the
// add-chain / switch-chain builders dedupe an in-flight prompt so a dapp that
// re-issues the same request never stacks a second card.
describe("createApprovalQueue per-kind origin guards and dedup", () => {
  const ORIGIN = "https://guard.example";
  const BAD_ORIGIN = "http://insecure.example";
  const chain = { chainId: "0x1", chainName: "Custom" } as never;
  const declare = { compiledClassHash: "0x1", contract: {} } as never;
  const actions = [{ amount: "1", kind: "transfer", to: "0x2", token: "0x3" }] as never;

  test("rejects add-chain requests from an invalid origin", () => {
    const queue = createApprovalQueue();
    expect(() => queue.requestAddChain({ chain, origin: BAD_ORIGIN, summaries: ["Add"] })).toThrow(
      "Invalid origin",
    );
    expect(queue.list()).toEqual([]);
  });

  test("dedupes an add-chain request by origin and chain id", () => {
    const queue = createApprovalQueue();
    const first = queue.requestAddChain({ chain, origin: ORIGIN, summaries: ["Add"] });
    const repeat = queue.requestAddChain({ chain, origin: ORIGIN, summaries: ["Add again"] });
    const otherChain = queue.requestAddChain({
      chain: { chainId: "0x2", chainName: "Other" } as never,
      origin: ORIGIN,
      summaries: ["Add other"],
    });

    expect(repeat).toEqual(first);
    expect(otherChain.id).not.toBe(first.id);
    expect(queue.list()).toHaveLength(2);
  });

  test("rejects declare requests from an invalid origin", () => {
    const queue = createApprovalQueue();
    expect(() =>
      queue.requestDeclare({
        context: CONTEXT,
        declare,
        declaration: DECLARATION,
        origin: BAD_ORIGIN,
        summaries: ["Declare"],
      }),
    ).toThrow("Invalid origin");
  });

  test("rejects invoke requests from an invalid origin", () => {
    const queue = createApprovalQueue();
    expect(() =>
      queue.requestInvoke({
        fee: { fee: null, feeEstimateFailed: false, requiresDeployment: false },
        calls: [],
        context: CONTEXT,
        flags: [],
        origin: BAD_ORIGIN,
        summaries: ["Invoke"],
      }),
    ).toThrow("Invalid origin");
  });

  test("rejects sign-typed-data requests from an invalid origin", () => {
    const queue = createApprovalQueue();
    expect(() =>
      queue.requestSignTypedData({
        context: CONTEXT,
        origin: BAD_ORIGIN,
        summary: "Sign",
        typedData: {},
      }),
    ).toThrow("Invalid origin");
  });

  test("rejects strk20 invoke requests from an invalid origin", () => {
    const queue = createApprovalQueue();
    expect(() =>
      queue.requestStrk20Invoke({
        actions,
        calls: [],
        context: CONTEXT,
        origin: BAD_ORIGIN,
        summaries: ["Send"],
      }),
    ).toThrow("Invalid origin");
  });

  test("rejects switch-chain requests from an invalid origin", () => {
    const queue = createApprovalQueue();
    expect(() =>
      queue.requestSwitchChain({
        chainId: "0x534e5f4d41494e",
        networkId: "SN_MAIN",
        origin: BAD_ORIGIN,
        summary: "Switch",
      }),
    ).toThrow("Invalid origin");
  });

  test("dedupes a switch-chain request by origin and chain id", () => {
    const queue = createApprovalQueue();
    const first = queue.requestSwitchChain({
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN",
      origin: ORIGIN,
      summary: "Switch",
    });
    const repeat = queue.requestSwitchChain({
      chainId: "0x534e5f4d41494e",
      networkId: "SN_MAIN",
      origin: ORIGIN,
      summary: "Switch again",
    });
    const other = queue.requestSwitchChain({
      chainId: "0x534e5f5345504f4c4941",
      networkId: "SN_SEPOLIA",
      origin: ORIGIN,
      summary: "Switch other",
    });

    expect(repeat).toEqual(first);
    expect(other.id).not.toBe(first.id);
    expect(queue.list()).toHaveLength(2);
  });
});

// The fee review is snapshotted on the way in and out, and can be replaced in
// place by the panel's retry without disturbing the held calls (#189).
describe("createApprovalQueue invoke fee review", () => {
  const ORIGIN = "https://fee.example";
  const calls = [{ calldata: ["0x1"], contractAddress: "0x2", entrypoint: "transfer" }];

  test("carries the fee review on snapshots and isolates it from callers", () => {
    const queue = createApprovalQueue();
    const fee = { overallFee: "1200", unit: "FRI" };
    const { id } = queue.requestInvoke({
      calls,
      context: CONTEXT,
      fee: { fee, feeEstimateFailed: false, requiresDeployment: false },
      flags: [],
      origin: ORIGIN,
      summaries: ["Invoke"],
    });

    const snapshot = queue.get(id);
    expect(snapshot).toMatchObject({
      fee: { overallFee: "1200", unit: "FRI" },
      feeEstimateFailed: false,
      requiresDeployment: false,
    });
    // Mutating the caller's estimate or the snapshot never reaches the queue.
    fee.overallFee = "9999";
    (snapshot?.fee as { overallFee: string }).overallFee = "8888";
    expect(queue.get(id)?.fee).toEqual({ overallFee: "1200", unit: "FRI" });
  });

  test("updateInvokeFee replaces the fee review and leaves the payload intact", () => {
    const queue = createApprovalQueue();
    const { id } = queue.requestInvoke({
      calls,
      context: CONTEXT,
      fee: { fee: null, feeEstimateFailed: true, requiresDeployment: false },
      flags: [],
      origin: ORIGIN,
      summaries: ["Invoke"],
    });

    const updated = queue.updateInvokeFee(id, {
      fee: { overallFee: "77", unit: "FRI" },
      feeEstimateFailed: false,
      requiresDeployment: false,
    });
    expect(updated).toMatchObject({ fee: { overallFee: "77", unit: "FRI" } });
    expect(queue.get(id)?.feeEstimateFailed).toBe(false);
    expect(queue.payload(id)).toEqual({ calls });
  });

  test("updateInvokeFee rejects unknown ids and non-invoke approvals", () => {
    const queue = createApprovalQueue();
    const connect = queue.request(ORIGIN);
    const review = { fee: null, feeEstimateFailed: false, requiresDeployment: false };

    expect(queue.updateInvokeFee("9e107d9d-372b-4b6b-8d0a-df1b6c8f6e01", review)).toBeNull();
    expect(queue.updateInvokeFee(connect.id, review)).toBeNull();
    expect(queue.get(connect.id)?.fee).toBeUndefined();
  });
});
