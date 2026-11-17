/**
 * Pinned-block reads: every call in a group is asked at the same accepted
 * block hash, a sibling node that does not know the pin is re-pinned, and a
 * malformed head answer fails closed.
 */
import { describe, expect, test } from "bun:test";
import type { RpcProvider } from "starknet";
import { readAtPinnedBlock, withPinnedBlock } from "../../src/rpc/pinned-block";

type Seen = { readonly block: unknown; readonly entrypoint: string };

const provider = (heads: readonly unknown[], answer: (seen: Seen, call: number) => unknown) => {
  const seen: Seen[] = [];
  let head = 0;
  const fake = {
    async callContract(call: { readonly entrypoint: string }, block: unknown) {
      const entry = { block, entrypoint: call.entrypoint };
      seen.push(entry);
      const result = answer(entry, seen.length);
      if (result instanceof Error) throw result;
      return result;
    },
    async getBlockLatestAccepted() {
      const value = heads[Math.min(head, heads.length - 1)];
      head += 1;
      return value;
    },
  } as unknown as RpcProvider;
  return { fake, seen };
};

describe("readAtPinnedBlock", () => {
  test("asks every read at the one accepted block", async () => {
    const { fake, seen } = provider([{ block_hash: "0xb10c", block_number: 7 }], () => ["0x1"]);
    const result = await readAtPinnedBlock(
      ["https://rpc.example"],
      async (read) => [await read("0xa", "first", []), await read("0xb", "second", ["0x2"])],
      () => fake,
    );
    expect(result).toEqual([["0x1"], ["0x1"]]);
    expect(seen).toEqual([
      { block: "0xb10c", entrypoint: "first" },
      { block: "0xb10c", entrypoint: "second" },
    ]);
  });

  test("re-pins when the answering node does not know the pinned block", async () => {
    const { fake, seen } = provider(
      [
        { block_hash: "0xb1", block_number: 1 },
        { block_hash: "0xb2", block_number: 2 },
      ],
      (_seen, call) => (call === 1 ? new Error("24: Block not found") : ["0x5"]),
    );
    await expect(
      readAtPinnedBlock(
        ["https://rpc.example"],
        (read) => read("0xa", "x", []),
        () => fake,
      ),
    ).resolves.toEqual(["0x5"]);
    expect(seen.map((entry) => entry.block)).toEqual(["0xb1", "0xb2"]);
  });
});

describe("withPinnedBlock", () => {
  test("a malformed head answer fails closed before any read", async () => {
    const { fake, seen } = provider([{ block_hash: "0x0", block_number: 1 }], () => ["0x1"]);
    await expect(withPinnedBlock(fake, async () => "read")).rejects.toThrow(
      "Invalid accepted block response",
    );
    expect(seen).toEqual([]);
  });

  test("an error other than a missing block is not retried", async () => {
    const { fake } = provider([{ block_hash: "0xb1", block_number: 1 }], () => ["0x1"]);
    let attempts = 0;
    await expect(
      withPinnedBlock(fake, async () => {
        attempts += 1;
        throw new Error("contract reverted");
      }),
    ).rejects.toThrow("contract reverted");
    expect(attempts).toBe(1);
  });
});
