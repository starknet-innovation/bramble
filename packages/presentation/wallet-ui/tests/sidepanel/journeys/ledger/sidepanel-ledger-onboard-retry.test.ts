/**
 * Onboarding must not run two device sessions at once. Cancel closes the
 * transport before a queued Connect opens another, and a stale-handle failure
 * is retried once before any error is shown.
 */
import { describe, expect, test } from "bun:test";
import { LedgerRejection, ledgerMessage } from "@bramble/ledger-protocol/errors";
import { createLedgerOnboardController } from "../../../../src/sidepanel/journeys/ledger/onboard-session";
import { onboardHarness, tick } from "../../../support/ledger-onboard-harness";

describe("onboarding device session", () => {
  test("cancel during device listing still accepts the next connect", async () => {
    const pending: ((devices: readonly { id: string; label: string }[]) => void)[] = [];
    let opened = 0;
    const session = () => {
      opened += 1;
      return { client: {} as never, close: async () => undefined, readiness: "verified" as const };
    };
    const h = onboardHarness({
      connector: {
        listConnected: () => new Promise((resolve) => pending.push(resolve)),
        openConnected: async () => session(),
        request: async () => session(),
      },
      enumerate: () => Promise.resolve([]),
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.start();
    controller.connect();
    await tick();
    expect(pending).toHaveLength(1);
    expect(opened).toBe(0);

    controller.cancel();
    controller.start();
    controller.connect();
    await tick();
    expect(pending).toHaveLength(2);
    expect(opened).toBe(0);

    pending[1]?.([{ id: "ledger-device-1", label: "Nano X" }]);
    for (let i = 0; i < 5; i += 1) await tick();
    expect(opened).toBe(1);

    pending[0]?.([{ id: "ledger-device-1", label: "Nano X" }]);
    for (let i = 0; i < 5; i += 1) await tick();
    expect(opened).toBe(1);
  });

  test("cancel then connect does not open a second session over the first", async () => {
    let open = 0;
    let maxOpen = 0;
    const releases: (() => void)[] = [];
    const session = () => {
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      let closed = false;
      return {
        client: {} as never,
        close: async () => {
          if (closed) return;
          closed = true;
          open -= 1;
        },
        readiness: "verified" as const,
      };
    };
    const h = onboardHarness({
      connector: {
        isAvailable: () => true,
        listConnected: async () => [{ id: "ledger-device-1", label: "Nano X" }],
        openConnected: async () => session(),
        request: async () => session(),
      },
      enumerate: () => new Promise((resolve) => releases.push(() => resolve([]))),
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.start();
    controller.connect();
    for (let i = 0; i < 5; i += 1) await tick();
    expect(open).toBe(1);

    controller.cancel();
    controller.start();
    controller.connect();
    for (let i = 0; i < 5; i += 1) await tick();
    expect(maxOpen).toBe(1);
    expect(open).toBe(0);

    // The cancelled read still owes one page per scheme. Finishing those lets
    // the queued Connect open, and it must be the only session.
    for (let i = 0; i < 8 && open === 0; i += 1) {
      for (const release of releases.splice(0)) release();
      await tick();
    }
    expect(maxOpen).toBe(1);
    expect(open).toBe(1);
    for (const release of releases.splice(0)) release();
    await tick();
  });

  test("an own-stale read is retried once and shows no error", async () => {
    let calls = 0;
    const h = onboardHarness({
      enumerate: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(
            new LedgerRejection("unexpected-device-error", undefined, {
              causeName: "InvalidStateError",
              ownStale: true,
            }),
          );
        }
        return Promise.resolve([]);
      },
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    for (let i = 0; i < 8; i += 1) await tick();
    expect(calls).toBe(2);
    expect(h.views.at(-1)?.kind).not.toBe("error");
  });

  test("a stale read that fails twice shows the cause name, not another app", async () => {
    const h = onboardHarness({
      enumerate: () =>
        Promise.reject(
          new LedgerRejection("unexpected-device-error", undefined, {
            causeName: "InvalidStateError",
            ownStale: true,
          }),
        ),
    });
    const controller = createLedgerOnboardController(h.deps);
    controller.connect();
    for (let i = 0; i < 8; i += 1) await tick();
    expect(h.views.at(-1)).toEqual({
      kind: "error",
      message: ledgerMessage("unexpected-device-error"),
      supportCode: "Support code · unexpected-device-error · InvalidStateError",
    });
    expect(JSON.stringify(h.views.at(-1))).not.toContain("Another app");
  });
});
