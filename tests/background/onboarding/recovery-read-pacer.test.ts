/**
 * The discovery read budget: pacing under the gateway's per-address limit, and
 * waiting out a refusal instead of ending the walk on it.
 *
 * The built-in gateway admits 500 JSON-RPC calls per minute per IP in a fixed
 * window. These suites pin the pacer's side of that contract on a virtual
 * clock: no window carries more than the budget, a refusal holds every read
 * for its Retry-After or the endpoints' cooldown, and anything that is not a
 * refusal still fails the read closed.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WalletError } from "@bramble/core/errors";
import {
  RPC_REFUSED_MESSAGE,
  type RpcEndpointBackoff,
  RpcRefusedError,
  RpcTransportError,
} from "@bramble/starknet/provider";
import { RECOVERY_SCAN_PACING } from "@bramble/wallet-model/recovery";
import { APPROVAL_KEEPALIVE_MS } from "../../../apps/extension/src/background/approvals/approval-keepalive";
import { createRecoveryReadPacer } from "../../../apps/extension/src/background/onboarding/recovery-read-pacer";
import { createVirtualTime } from "../../support/virtual-time";
import { EXTENSION_SRC_DIR } from "../../support/workspace-sources";

const RPC_URLS = [
  "https://wallet.nodes.starknet.org/rpc/mainnet/v0_10",
  "https://mainnet.nodes.starknet.org/rpc/v0_10",
] as const;
const MINUTE_MS = 60_000;

const install = (
  options: {
    readonly backoff?: (rpcUrls: readonly string[]) => RpcEndpointBackoff | null;
    readonly keepAlive?: () => void;
    readonly start?: number;
    readonly wallClock?: () => number;
  } = {},
) => {
  const time = createVirtualTime(options.start ?? 0);
  const pacer = createRecoveryReadPacer({
    backoff: options.backoff ?? (() => null),
    now: time.now,
    sleep: time.sleep,
    wallClock: options.wallClock ?? (() => 0),
    ...(options.keepAlive ? { keepAlive: options.keepAlive } : {}),
  });
  return { pacer, time };
};

// The most calls any span of `spanMs` carries, from sorted start times.
const busiestSpan = (starts: readonly number[], spanMs: number): number => {
  let busiest = 0;
  let first = 0;
  for (let last = 0; last < starts.length; last += 1) {
    while ((starts[last] ?? 0) - (starts[first] ?? 0) >= spanMs) first += 1;
    busiest = Math.max(busiest, last - first + 1);
  }
  return busiest;
};

// The most calls any gateway minute (aligned to the epoch) carries.
const busiestGatewayMinute = (starts: readonly number[]): number => {
  const perMinute = new Map<number, number>();
  for (const start of starts) {
    const minute = Math.floor(start / MINUTE_MS);
    perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
  }
  return Math.max(0, ...perMinute.values());
};

describe("recovery read pacing", () => {
  test("a twenty-index walk stays under the gateway's minute and still finishes", async () => {
    // Seven shapes per index, each a class-hash read then three balance reads:
    // the ~560 calls an unpaced walk used to send in seconds.
    const { pacer, time } = install({ start: 41_250 });
    const starts: number[] = [];
    const call = (calls: number) =>
      pacer.read(RPC_URLS, calls, async () => {
        for (let slot = 0; slot < calls; slot += 1) starts.push(time.now());
        await time.sleep(120);
        return true;
      });
    const walk = async () => {
      for (let index = 0; index < 20; index += 1) {
        await Promise.all(
          Array.from({ length: 7 }, async () => {
            await call(1);
            await call(3);
          }),
        );
      }
    };
    const startedAt = time.now();
    await time.settle(walk());

    expect(starts.length).toBe(560);
    expect(busiestSpan(starts, RECOVERY_SCAN_PACING.windowMs)).toBeLessThanOrEqual(
      RECOVERY_SCAN_PACING.callsPerWindow,
    );
    expect(busiestSpan(starts, MINUTE_MS)).toBeLessThanOrEqual(360);
    expect(busiestGatewayMinute(starts)).toBeLessThan(500);
    // Paced, not stalled: the budget's own rate sets the length of the walk.
    expect(time.now() - startedAt).toBeLessThan(100_000);
  });

  test("lets a small read through at once", async () => {
    const { pacer, time } = install({ start: 5_000 });
    const answer = await time.settle(pacer.read(RPC_URLS, 3, async () => time.now()));
    expect(answer).toBe(5_000);
  });
});

describe("recovery read refusals", () => {
  test("a refused read pauses every paced read for its Retry-After, then resumes", async () => {
    const { pacer, time } = install();
    const attempts: number[] = [];
    const refusedOnce = pacer.read(RPC_URLS, 1, async () => {
      attempts.push(time.now());
      if (attempts.length === 1) throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "37");
      return "answered";
    });
    // A second read asked for while the first is paused waits out the pause.
    const queued = (async () => {
      await time.sleep(1_000);
      return pacer.read(RPC_URLS, 1, async () => time.now());
    })();

    const [answer, queuedStart] = await time.settle(Promise.all([refusedOnce, queued]));

    expect(answer).toBe("answered");
    expect(attempts).toEqual([0, 37_000]);
    expect(queuedStart).toBeGreaterThanOrEqual(37_000);
  });

  test("honors an HTTP-date Retry-After against the wall clock", async () => {
    const wall = Date.parse("2026-10-19T10:00:00.000Z");
    const { pacer, time } = install({ wallClock: () => wall + time.now() });
    const attempts: number[] = [];
    await time.settle(
      pacer.read(RPC_URLS, 1, async () => {
        attempts.push(time.now());
        if (attempts.length === 1) {
          throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "Mon, 19 Oct 2026 10:00:42 GMT");
        }
        return true;
      }),
    );
    expect(attempts).toEqual([0, 42_000]);
  });

  test("waits for the endpoints' cooldown when it outlasts the Retry-After", async () => {
    // The fallback refused without a Retry-After while the gateway's own
    // cooldown runs longer: retrying sooner would only meet that cooldown.
    const { pacer, time } = install({ backoff: () => ({ refused: true, retryInMs: 30_000 }) });
    const attempts: number[] = [];
    await time.settle(
      pacer.read(RPC_URLS, 1, async () => {
        attempts.push(time.now());
        if (attempts.length === 1) throw new RpcRefusedError(RPC_REFUSED_MESSAGE, null);
        return true;
      }),
    );
    expect(attempts).toEqual([0, 30_000]);
  });

  test("waits out a back-off the wallet itself imposed after refusals", async () => {
    // Every endpoint is cooling down after refusing, so withRpcFallback sent
    // nothing and threw its generic transport error: that is still a refusal.
    let cooling: RpcEndpointBackoff | null = { refused: true, retryInMs: 12_000 };
    const { pacer, time } = install({ backoff: () => cooling });
    const attempts: number[] = [];
    await time.settle(
      pacer.read(RPC_URLS, 1, async () => {
        attempts.push(time.now());
        if (attempts.length === 1) {
          throw new RpcTransportError("RPC endpoints are temporarily unavailable");
        }
        cooling = null;
        return true;
      }),
    );
    expect(attempts).toEqual([0, 12_000]);
  });

  test("clamps a pause between its floor and its ceiling", async () => {
    const { pacer, time } = install();
    const attempts: number[] = [];
    await time.settle(
      pacer.read(RPC_URLS, 1, async () => {
        attempts.push(time.now());
        if (attempts.length === 1) throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "600");
        if (attempts.length === 2) throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "0");
        return true;
      }),
    );
    const { maxPauseMs, minPauseMs } = RECOVERY_SCAN_PACING;
    expect(attempts).toEqual([0, maxPauseMs, maxPauseMs + minPauseMs]);
  });

  test("gives up after a bounded number of retries with the refusal itself", async () => {
    const { pacer, time } = install();
    let attempts = 0;
    const rejection = await time
      .settle(
        pacer.read(RPC_URLS, 1, async () => {
          attempts += 1;
          throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "60");
        }),
      )
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(RpcRefusedError);
    expect((rejection as Error).message).toBe(RPC_REFUSED_MESSAGE);
    expect(attempts).toBe(RECOVERY_SCAN_PACING.refusalRetries + 1);
    expect(time.now()).toBe(RECOVERY_SCAN_PACING.refusalRetries * 60_000);
  });

  test("touches the worker keepalive through a long pause", async () => {
    const touches: number[] = [];
    const { pacer, time } = install({ keepAlive: () => touches.push(time.now()) });
    let attempts = 0;
    await time.settle(
      pacer.read(RPC_URLS, 1, async () => {
        attempts += 1;
        if (attempts === 1) throw new RpcRefusedError(RPC_REFUSED_MESSAGE, "60");
        return true;
      }),
    );
    const gaps = touches.slice(1).map((touch, index) => touch - (touches[index] ?? 0));
    expect(touches[0]).toBe(0);
    expect(touches.at(-1)).toBeGreaterThanOrEqual(60_000 - APPROVAL_KEEPALIVE_MS);
    expect(gaps.every((gap) => gap <= APPROVAL_KEEPALIVE_MS)).toBe(true);
  });
});

describe("recovery read failures that are not refusals", () => {
  const failures: ReadonlyArray<readonly [string, unknown, RpcEndpointBackoff | null]> = [
    ["a semantic answer", new WalletError("Invalid token balance response"), null],
    ["a timeout", new RpcTransportError("RPC request timed out"), null],
    [
      "an outage the endpoints are cooling down from",
      new RpcTransportError("RPC endpoints are temporarily unavailable"),
      { refused: false, retryInMs: 30_000 },
    ],
  ];
  for (const [label, failure, cooling] of failures) {
    test(`fails ${label} closed at once`, async () => {
      const { pacer, time } = install({ backoff: () => cooling });
      let attempts = 0;
      const rejection = await time
        .settle(
          pacer.read(RPC_URLS, 1, async () => {
            attempts += 1;
            throw failure;
          }),
        )
        .catch((error: unknown) => error);
      expect(rejection).toBe(failure);
      expect(attempts).toBe(1);
      // Nothing was paused: the next read goes out immediately.
      expect(await time.settle(pacer.read(RPC_URLS, 1, async () => time.now()))).toBe(0);
    });
  }
});

test("the background shares one pacer across discovery pages and its keepalive", async () => {
  const source = await readFile(join(EXTENSION_SRC_DIR, "background/index.ts"), "utf8");
  expect(source).toMatch(/^const recoveryReads = createRecoveryReadPacer\(keepAliveOption\);$/m);
  expect(source).toContain("  recoveryReads,\n");
});
