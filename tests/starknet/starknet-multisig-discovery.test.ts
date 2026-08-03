/**
 * Multisig proposal event-discovery tests cover pagination, hostile event
 * shapes, recency fallback, and the production provider adapter.
 */
import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import {
  collectMultisigProposalIds,
  discoverMultisigProposalIds,
  MULTISIG_TRANSACTION_SUBMITTED_EVENT_KEY,
  type MultisigProposalDiscoveryRpc,
} from "../../src/starknet/multisig-discovery";

const MULTISIG = "0x123";
const SIGNER = "0x456";
const submitted = (id: string) => ({
  keys: [MULTISIG_TRANSACTION_SUBMITTED_EVENT_KEY, id, SIGNER],
});

describe("collectMultisigProposalIds", () => {
  test("pages, validates, canonicalizes, de-duplicates, and returns newest first", async () => {
    const filters: unknown[] = [];
    const rpc: MultisigProposalDiscoveryRpc = {
      async getEvents(filter) {
        filters.push(filter);
        if (filter.continuation_token === undefined) {
          return {
            continuation_token: "next",
            events: [
              submitted("0x01"),
              { keys: ["0x999", "0x2", SIGNER] },
              { keys: [MULTISIG_TRANSACTION_SUBMITTED_EVENT_KEY, "bad", SIGNER] },
            ],
          };
        }
        return { events: [submitted("0x2"), submitted("0x1")] };
      },
      async getLatestBlockNumber() {
        return 1_500_000;
      },
    };

    await expect(collectMultisigProposalIds(rpc, MULTISIG)).resolves.toEqual({
      complete: true,
      ids: ["0x2", "0x1"],
    });
    expect(filters).toHaveLength(2);
    expect(filters[0]).toMatchObject({
      address: MULTISIG,
      from_block: 500_000,
      keys: [[MULTISIG_TRANSACTION_SUBMITTED_EVENT_KEY]],
      to_block: 1_500_000,
    });
  });

  test("retries a truncated scan over the newest block stride and exposes truncation", async () => {
    const fromBlocks: number[] = [];
    const rpc: MultisigProposalDiscoveryRpc = {
      async getEvents(filter) {
        fromBlocks.push(filter.from_block);
        return filter.from_block === 900_000
          ? { events: [submitted("0x99")] }
          : { continuation_token: "more", events: [submitted("0x1")] };
      },
      async getLatestBlockNumber() {
        return 1_000_000;
      },
    };

    await expect(collectMultisigProposalIds(rpc, MULTISIG)).resolves.toEqual({
      complete: false,
      ids: ["0x99"],
    });
    expect(fromBlocks).toEqual([0, 0, 0, 0, 0, 900_000]);
  });

  test("rejects invalid addresses and block heights", async () => {
    const rpc: MultisigProposalDiscoveryRpc = {
      async getEvents() {
        return { events: [] };
      },
      async getLatestBlockNumber() {
        return -1;
      },
    };
    await expect(collectMultisigProposalIds(rpc, "0x0")).rejects.toThrow(
      "Invalid multisig address",
    );
    await expect(collectMultisigProposalIds(rpc, MULTISIG)).rejects.toThrow(
      "Invalid multisig block response",
    );
  });
});

describe("discoverMultisigProposalIds", () => {
  test("adapts the bounded numeric filter to RpcProvider block identifiers", async () => {
    let seen: unknown;
    const provider = {
      async getBlockNumber() {
        return 10;
      },
      async getEvents(filter: unknown) {
        seen = filter;
        return { events: [submitted("0x7")] };
      },
    } as unknown as RpcProvider;

    await expect(
      discoverMultisigProposalIds(
        { address: MULTISIG, rpcUrls: ["https://rpc.example"] },
        () => provider,
      ),
    ).resolves.toEqual({ complete: true, ids: ["0x7"] });
    expect(seen).toMatchObject({
      from_block: { block_number: 0 },
      to_block: { block_number: 10 },
    });
  });
});
