/**
 * Product invariant for MCW-V09-106 at the render path. The consent queue the
 * user actually sees comes from `createSidepanelRuntime().loadPendingApprovals`,
 * so these tests drive that wrapper — not the underlying parser — and pin that a
 * single malformed prompt in the background reply never blanks the prompts the
 * user still has to approve or reject. The envelope-level bounds (queue length,
 * array shape) still collapse to an empty queue, because those describe a reply
 * the wallet has no reason to trust at all.
 */
import { describe, expect, test } from "bun:test";
import { JSON_BUDGETS } from "../../src/shared/json";
import { runtimeReturning } from "../support/runtime-client-fixtures";

const ORIGIN = "https://dapp.example";
const HONEST_ORIGIN = "https://honest.example";

const uuid = (index: number): string =>
  `b81c5dd1-53ff-4b7b-a171-${index.toString(16).padStart(12, "0")}`;

const honestPrompt = { id: uuid(1), origin: HONEST_ORIGIN };

const loadQueue = async (pending: unknown): Promise<readonly unknown[]> =>
  await runtimeReturning({ ok: true, pending }).loadPendingApprovals();

describe("side panel consent queue rendering (MCW-V09-106)", () => {
  test("keeps the honest prompt when an unknown approval kind is queued first", async () => {
    const unknownKind = { id: uuid(2), kind: "future-prompt", origin: ORIGIN };
    expect(await loadQueue([unknownKind, honestPrompt])).toEqual([honestPrompt]);
    expect(await loadQueue([honestPrompt, unknownKind])).toEqual([honestPrompt]);
  });

  test("keeps the honest prompt when a dapp forces an over-long add-chain host", async () => {
    // `wallet_addStarknetChain` with a 400-character RPC host: the background
    // records the host verbatim as a summary, and the popup's 300-character cap
    // rejects that one entry. Pre-fix this blanked the whole rendered queue.
    const longHost = {
      id: uuid(3),
      kind: "add-chain",
      origin: ORIGIN,
      summaries: ["Evil Chain", "0x534e5f5345504f4c4941", `${"a".repeat(400)}.example.com`],
    };
    expect(await loadQueue([longHost, honestPrompt])).toEqual([honestPrompt]);
  });

  test("keeps the honest prompt when a queued fee unit is neither FRI nor WEI", async () => {
    const badUnit = {
      context: {
        accountId: "SN_MAIN:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcde",
        chainId: "0x534e5f4d41494e",
        networkId: "SN_MAIN",
        payloadDigest: `sha256:${"a".repeat(64)}`,
      },
      fee: { overallFee: "1", unit: "GWEI" },
      id: uuid(4),
      kind: "invoke",
      origin: ORIGIN,
    };
    expect(await loadQueue([badUnit, honestPrompt])).toEqual([honestPrompt]);
  });

  test("renders nothing for a reply that is not a pending-approvals envelope", async () => {
    expect(await runtimeReturning({ error: "boom" }).loadPendingApprovals()).toEqual([]);
    expect(await runtimeReturning({ ok: true }).loadPendingApprovals()).toEqual([]);
    expect(await loadQueue({})).toEqual([]);
  });

  test("renders nothing for an unbounded or shape-smuggling queue", async () => {
    const overCap = Array.from(
      { length: JSON_BUDGETS.provider.maxArrayLength + 1 },
      (_, index) => ({
        id: uuid(index + 16),
        origin: `https://site-${index}.example`,
      }),
    );
    expect(await loadQueue(overCap)).toEqual([]);

    const smuggling: unknown[] = [honestPrompt];
    Object.defineProperty(smuggling, "extra", { enumerable: true, value: { id: uuid(5) } });
    expect(await loadQueue(smuggling)).toEqual([]);
  });
});
