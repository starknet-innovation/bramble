/** Content provider event ordering and coalescing regression checks. */
import { describe, expect, test } from "bun:test";
import type { ProviderEvent } from "@bramble/wallet-protocol/events";
import { createProviderEventRefresh } from "../../../apps/extension/src/content/provider-event-refresh";
import { flushHeld } from "../../support/held";

const first = ["0xaaa"] as const;
const latest = ["0xbbb"] as const;

describe("content provider event refresh", () => {
  test("serializes and coalesces broadcasts so an old read cannot regress state", async () => {
    const releases: (() => void)[] = [];
    const responses = [first, latest];
    let reads = 0;
    const posted: ProviderEvent[] = [];
    const refresh = createProviderEventRefresh({
      post: (event) => posted.push(event),
      readAddresses: async () => {
        const index = reads;
        reads += 1;
        await new Promise<void>((resolve) => releases.push(resolve));
        return responses[index] ?? latest;
      },
    });

    refresh.enqueue({ chainId: "0x1", event: "networkChanged", type: "wallet.event" });
    refresh.enqueue({ chainId: "0x2", event: "networkChanged", type: "wallet.event" });
    refresh.enqueue({ event: "accountsChanged", type: "wallet.event" });
    expect(reads).toBe(1);
    releases.shift()?.();
    await flushHeld();
    expect(reads).toBe(2);
    releases.shift()?.();
    await flushHeld();

    expect(posted).toEqual([
      { data: "0x1", event: "networkChanged", target: "bramble:page" },
      { data: first, event: "accountsChanged", target: "bramble:page" },
      { data: "0x2", event: "networkChanged", target: "bramble:page" },
      { data: latest, event: "accountsChanged", target: "bramble:page" },
    ]);
    expect(reads).toBe(2);
  });
});
