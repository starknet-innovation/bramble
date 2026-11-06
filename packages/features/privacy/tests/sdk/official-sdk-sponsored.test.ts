/**
 * The service half of the sponsored first shield (#789): only a deposit batch
 * (approvals, then the configured pool's `apply_actions`) is ever relayed on a
 * sponsor's plan, the proof's block matures first exactly as on the public
 * route, and the scope is claimed as a relay write.
 */
import { describe, expect, test } from "bun:test";
import type { Strk20MaturityRuntime } from "@bramble/privacy/official-sdk-maturity";
import type { Strk20SponsoredShieldSubmissionInput } from "@bramble/privacy/sponsored-shield";
import { type Call, OutsideExecutionVersion, outsideExecution } from "starknet";
import { sponsoredShieldSubmitter } from "../../src/sdk/official-sdk-sponsored";

const POOL = "0x123";
const APPROVE: Call = {
  calldata: [POOL, "0x5", "0x0"],
  contractAddress: "0x77",
  entrypoint: "approve",
};
const APPLY: Call = { calldata: ["0x0"], contractAddress: POOL, entrypoint: "apply_actions" };

const input = (calls: readonly Call[]): Strk20SponsoredShieldSubmissionInput =>
  ({
    // OpenZeppelin skips the live-class read, so signing stays off the network.
    account: {
      accountContractType: "openzeppelin",
      address: "0xabc",
      id: "a",
      networkId: "SN_SEPOLIA",
    },
    calls,
    config: { poolAddress: POOL },
    isAuthorized: () => true,
    plan: {
      authorization: {
        caller: "0x99",
        executeAfter: "0x1",
        executeBefore: "0x2710",
        publicCallCount: 1,
      },
      mode: "sponsored-deposit",
      sponsor: "Starknet Foundation",
      typedData: outsideExecution.getTypedData(
        "0x534e5f5345504f4c4941",
        { caller: "0x99", execute_after: "0x1", execute_before: "0x2710" },
        "0x5",
        [APPROVE],
        OutsideExecutionVersion.V2,
      ),
    },
    proof: { data: "AAEC", output: ["0x1"], proof_facts: ["0x2"] },
    relay: { url: "https://gateway.test/sponsor" },
    rpcUrls: ["https://rpc.test"],
    signHash: async () => ({ publicKey: "0x1", r: "0x2", s: "0x3" }),
    viewingKey: async () => "0x4",
  }) as unknown as Strk20SponsoredShieldSubmissionInput;

const harness = (clock: boolean = true) => {
  const routes: string[] = [];
  const matured: unknown[] = [];
  const submitter = sponsoredShieldSubmitter({
    http: async () =>
      new Response(
        JSON.stringify({
          id: "bramble-strk20",
          jsonrpc: "2.0",
          result: { transaction_hash: "0x9" },
        }),
        { status: 200 },
      ),
    maturity: {
      provingBlock: async (_provider: unknown, scope: unknown) => {
        matured.push(scope);
      },
    } as unknown as Strk20MaturityRuntime,
    ...(clock ? { nowSeconds: () => 100 } : {}),
    providerFor: () => ({}) as never,
    submission: async (_input, route, prepare, broadcast, relaySlots) => {
      routes.push(route);
      const prepared = await prepare({} as never, { scope: "s" } as never);
      relaySlots?.(prepared);
      return broadcast(prepared);
    },
  });
  return { matured, routes, submitter };
};

describe("sponsored shield submission", () => {
  test("relays a deposit batch as a relay write after the proof matures", async () => {
    const run = harness();
    await expect(run.submitter(input([APPROVE, APPLY]))).resolves.toEqual({
      transactionHash: "0x9",
    });
    expect(run.routes).toEqual(["relay"]);
    expect(run.matured).toHaveLength(1);
  });

  const leaks: readonly [string, readonly Call[]][] = [
    ["no approval at all", [APPLY]],
    ["a non-approve public call", [{ ...APPROVE, entrypoint: "transfer" }, APPLY]],
    ["the pool call before an approval", [APPLY, APPROVE]],
    ["another contract's apply_actions", [APPROVE, { ...APPLY, contractAddress: "0x456" }]],
    ["no pool call", [APPROVE]],
  ];
  for (const [name, calls] of leaks) {
    test(`refuses ${name} before claiming anything`, async () => {
      const run = harness();
      await expect(run.submitter(input(calls))).rejects.toThrow("strk20 privacy leak");
      expect(run.routes).toHaveLength(0);
    });
  }

  test("refuses with no clock, since the window could not be checked", async () => {
    const run = harness(false);
    await expect(run.submitter(input([APPROVE, APPLY]))).rejects.toThrow(
      "strk20 private submission unavailable",
    );
    expect(run.routes).toHaveLength(0);
  });
});
