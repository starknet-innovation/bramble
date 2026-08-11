import { describe, expect, it } from "vitest";
import {
  cacheChainActivities,
  interleaveChainActivities,
  readCachedChainActivities,
  type ChainActivity,
  type ChainActivityKind,
} from "./chain-activity-stream";

const activity = (
  kind: ChainActivityKind,
  index: number,
  timestampMs = 1_000,
): ChainActivity => ({
  blockNumber: 12,
  detail: "detail",
  href: "https://starkscan.co/tx/0x1",
  id: `${kind}:${index}`,
  kind,
  sourceTier: "head",
  timestampMs,
  title: kind,
});

describe("chain activity interleaving", () => {
  it("mixes available kinds instead of emitting source-shaped groups", () => {
    const mixed = interleaveChainActivities([
      activity("event", 1),
      activity("event", 2),
      activity("event", 3),
      activity("transaction", 1),
      activity("block", 1),
      activity("message", 1),
    ]);

    expect(new Set(mixed.slice(0, 4).map((row) => row.kind))).toEqual(
      new Set(["block", "event", "message", "transaction"]),
    );
    expect(mixed.filter((row) => row.kind === "event").map((row) => row.id)).toEqual([
      "event:1",
      "event:2",
      "event:3",
    ]);
  });

  it("keeps a validated twenty-row warm-start window", () => {
    const rows = Array.from({ length: 24 }, (_, index) =>
      activity(index % 2 === 0 ? "event" : "transaction", index, 1_000 + index),
    ).reverse();
    cacheChainActivities(rows);

    expect(readCachedChainActivities()).toHaveLength(20);
    expect(readCachedChainActivities()[0]?.id).toBe(rows[0]?.id);
    expect(readCachedChainActivities().at(-1)?.id).toBe(rows[19]?.id);
  });
});
