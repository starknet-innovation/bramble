/**
 * The per-journey cache of "can this recipient receive privately?".
 *
 * The answer is a pool round trip per address, so the registry debounces typing
 * and caches per recipient. The load-bearing property is that an unanswered
 * lookup reads as `unknown` — which gates as a wait — and never as a refusal: a
 * re-check must not flip an enabled control off under the user.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SidepanelWallet } from "../../src/sidepanel/runtime";
import { createRecipientStatus } from "../../src/sidepanel/transfer-recipient-status";

const ALICE = "0x0a";
const BOB = "0x0b";
const TOKEN = "SN_MAIN:STRK:0x1";

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

// Timers are captured rather than run, so the debounce can be observed instead
// of collapsed: firing immediately would make "one request per burst"
// indistinguishable from "one request per keystroke".
let pending: { fn: () => void; id: number }[] = [];
let nextTimerId = 1;

// A real macrotask, so the whole promise chain behind a lookup settles before
// the assertion — microtask ticks alone stop short of the `.then` handler.
const flush = (): Promise<void> =>
  new Promise((resolve) => {
    originalSetTimeout(resolve, 0);
  });

const fireTimers = (): void => {
  const due = pending;
  pending = [];
  for (const timer of due) {
    timer.fn();
  }
};

beforeEach(() => {
  pending = [];
  nextTimerId = 1;
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    const id = nextTimerId++;
    pending.push({ fn, id });
    return id;
  }) as unknown as typeof setTimeout;
  (globalThis as { clearTimeout: unknown }).clearTimeout = ((id: number) => {
    pending = pending.filter((timer) => timer.id !== id);
  }) as unknown as typeof clearTimeout;
});

afterEach(() => {
  (globalThis as { setTimeout: unknown }).setTimeout = originalSetTimeout;
  (globalThis as { clearTimeout: unknown }).clearTimeout = originalClearTimeout;
});

const registryWith = (
  answer: (recipient: string) => Promise<"registered" | "unregistered">,
): {
  readonly asked: readonly string[];
  readonly settled: () => number;
  readonly registry: ReturnType<typeof createRecipientStatus>;
} => {
  const asked: string[] = [];
  let settled = 0;
  const registry = createRecipientStatus({
    onSettled: () => {
      settled += 1;
    },
    wallet: {
      loadPrivacyRecipientStatus: async (_tokenId: string, recipient: string) => {
        asked.push(recipient);
        return answer(recipient);
      },
    } as unknown as SidepanelWallet,
  });
  return { asked, registry, settled: () => settled };
};

const registered = async (): Promise<"registered"> => "registered";

describe("createRecipientStatus", () => {
  test("reads unknown until an answer lands, then caches it", async () => {
    const { asked, registry, settled } = registryWith(registered);

    expect(registry.status(ALICE)).toBe("unknown");

    registry.check(TOKEN, ALICE);
    // Still unknown while the request is in flight — a pending answer gates as a
    // wait, not a refusal.
    expect(registry.status(ALICE)).toBe("unknown");
    expect(asked).toEqual([]);

    fireTimers();
    await flush();

    expect(asked).toEqual([ALICE]);
    expect(registry.status(ALICE)).toBe("registered");
    expect(settled()).toBe(1);
  });

  test("does not re-request a recipient it has already answered", async () => {
    const { asked, registry } = registryWith(registered);

    registry.check(TOKEN, ALICE);
    fireTimers();
    await flush();

    registry.check(TOKEN, ALICE);
    fireTimers();
    await flush();

    expect(asked).toEqual([ALICE]);
  });

  test("issues one request for a burst of checks rather than one per keystroke", async () => {
    const { asked, registry } = registryWith(registered);

    registry.check(TOKEN, ALICE);
    registry.check(TOKEN, BOB);
    fireTimers();
    await flush();

    expect(asked).toEqual([BOB]);
  });

  test("frees a superseded address so returning to it checks again", async () => {
    const { asked, registry } = registryWith(registered);

    registry.check(TOKEN, ALICE);
    registry.check(TOKEN, BOB);
    fireTimers();
    await flush();

    // Alice was abandoned mid-flight; she must not be left stuck on `unknown`.
    expect(registry.status(ALICE)).toBe("unknown");
    registry.check(TOKEN, ALICE);
    fireTimers();
    await flush();

    expect(asked).toEqual([BOB, ALICE]);
    expect(registry.status(ALICE)).toBe("registered");
  });

  test("forgets a failed lookup instead of caching it as a refusal", async () => {
    let attempts = 0;
    const { asked, registry, settled } = registryWith(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("discovery unavailable");
      }
      return "registered";
    });

    registry.check(TOKEN, ALICE);
    fireTimers();
    await flush();

    expect(registry.status(ALICE)).toBe("unknown");
    expect(settled()).toBe(1);

    registry.check(TOKEN, ALICE);
    fireTimers();
    await flush();

    expect(asked).toEqual([ALICE, ALICE]);
    expect(registry.status(ALICE)).toBe("registered");
  });

  test("caches an unregistered recipient so the refusal is stable", async () => {
    const { registry } = registryWith(async () => "unregistered");

    registry.check(TOKEN, BOB);
    fireTimers();
    await flush();

    expect(registry.status(BOB)).toBe("unregistered");
  });
});
