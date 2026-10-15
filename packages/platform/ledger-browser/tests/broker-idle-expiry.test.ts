/**
 * Idle expiry of the grant tab's broker (Sherlock 227). A panel normally sends
 * `close` when it is done with the device; one that died without sending it,
 * such as a toolbar popup that closed when the grant tab took focus, must not
 * leave the device claimed for good. The session closes through the same
 * `onClose` path after a quiet spell, never while a command is in flight.
 */
import { describe, expect, test } from "bun:test";
import {
  LEDGER_BROKER_IDLE_MS,
  type LedgerBrokerChannel,
  serveLedgerBroker,
} from "@bramble/ledger-browser/broker-server";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const fakeChannel = () => {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const channel: LedgerBrokerChannel = {
    addEventListener: (_type, listener) => listeners.add(listener),
    close: () => undefined,
    postMessage: () => undefined,
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  return {
    channel,
    emit: (data: unknown) => {
      for (const listener of listeners) {
        listener({ data } as MessageEvent<unknown>);
      }
    },
    listeners,
  };
};

// A scheduler under test control: `elapse` fires whatever timer is armed.
const manualTimer = () => {
  let armed: (() => void) | null = null;
  let scheduled = 0;
  return {
    elapse: () => {
      const fire = armed;
      armed = null;
      fire?.();
    },
    idle: {
      ms: LEDGER_BROKER_IDLE_MS,
      schedule: (onElapsed: () => void) => {
        scheduled += 1;
        armed = onElapsed;
        return () => {
          if (armed === onElapsed) {
            armed = null;
          }
        };
      },
    },
    isArmed: () => armed !== null,
    scheduled: () => scheduled,
  };
};

const versionClient = (appVersion: LedgerDeviceClient["getAppVersion"]): LedgerDeviceClient =>
  ({ getAppVersion: appVersion }) as unknown as LedgerDeviceClient;

const quickVersion = (): ReturnType<LedgerDeviceClient["getAppVersion"]> =>
  Promise.resolve({ errorMessage: "", major: 2, minor: 4, patch: 0, returnCode: 0x9000 });

describe("broker idle expiry", () => {
  test("closes a session no panel ever uses", () => {
    const fake = fakeChannel();
    const timer = manualTimer();
    let closes = 0;
    serveLedgerBroker(fake.channel, versionClient(quickVersion), () => (closes += 1), timer.idle);

    expect(timer.isArmed()).toBe(true);
    timer.elapse();

    expect(closes).toBe(1);
    expect(fake.listeners.size).toBe(0);
  });

  test("re-arms after every command, so an active panel is never cut off", async () => {
    const fake = fakeChannel();
    const timer = manualTimer();
    let closes = 0;
    serveLedgerBroker(fake.channel, versionClient(quickVersion), () => (closes += 1), timer.idle);
    const before = timer.scheduled();

    fake.emit({ id: 1, kind: "command", method: "getAppVersion" });
    await tick();

    expect(timer.scheduled()).toBeGreaterThan(before);
    expect(timer.isArmed()).toBe(true);
    expect(closes).toBe(0);
  });

  test("never expires while a command waits on the device", async () => {
    const fake = fakeChannel();
    const timer = manualTimer();
    let finish: (() => void) | null = null;
    let closes = 0;
    serveLedgerBroker(
      fake.channel,
      versionClient(
        () =>
          new Promise((resolve) => {
            finish = () =>
              resolve({ errorMessage: "", major: 2, minor: 4, patch: 0, returnCode: 0x9000 });
          }),
      ),
      () => (closes += 1),
      timer.idle,
    );

    fake.emit({ id: 1, kind: "command", method: "getAppVersion" });
    await tick();
    timer.elapse();
    expect(closes).toBe(0);

    (finish as unknown as () => void)();
    await tick();
    expect(timer.isArmed()).toBe(true);
    timer.elapse();
    expect(closes).toBe(1);
  });

  test("an explicit close or a detach stops the timer, and close reports once", () => {
    const closing = fakeChannel();
    const closeTimer = manualTimer();
    let closes = 0;
    serveLedgerBroker(
      closing.channel,
      versionClient(quickVersion),
      () => (closes += 1),
      closeTimer.idle,
    );
    closing.emit({ kind: "close" });
    expect(closes).toBe(1);
    expect(closeTimer.isArmed()).toBe(false);

    const detaching = fakeChannel();
    const detachTimer = manualTimer();
    const detach = serveLedgerBroker(
      detaching.channel,
      versionClient(quickVersion),
      () => (closes += 1),
      detachTimer.idle,
    );
    detach();
    expect(detachTimer.isArmed()).toBe(false);
    expect(closes).toBe(1);
  });

  test("the production bound outlasts the panel's own wait for the grant tab", () => {
    // grant-window.ts gives up on the tab after 120s; expiring before that would
    // close a session the panel is still entitled to open.
    expect(LEDGER_BROKER_IDLE_MS).toBeGreaterThan(120_000);
  });
});
