/**
 * The retained hardware broker ignores malformed messages, serializes APDU
 * operations, returns only catalogued failures, and releases on the exact close
 * command.
 */
import { describe, expect, test } from "bun:test";
import { type LedgerBrokerChannel, serveLedgerBroker } from "@bramble/ledger-browser/broker-server";
import type { LedgerDeviceClient } from "@bramble/ledger-protocol/client";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createFakeChannel = (): {
  readonly channel: LedgerBrokerChannel;
  readonly emit: (value: unknown) => void;
  readonly listeners: Set<(event: MessageEvent<unknown>) => void>;
  readonly posts: unknown[];
} => {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const posts: unknown[] = [];
  return {
    channel: {
      addEventListener: (_type, listener) => listeners.add(listener),
      close: () => undefined,
      postMessage: (message) => posts.push(message),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    },
    emit: (value) => {
      for (const listener of listeners) {
        listener({ data: value } as MessageEvent<unknown>);
      }
    },
    listeners,
    posts,
  };
};

const okClient = (): LedgerDeviceClient => ({
  getOsVersion: async () => ({ targetId: 0x33000004, version: "2.7.1" }),
  getAppVersion: async () => ({
    errorMessage: "",
    major: 2,
    minor: 4,
    patch: 0,
    returnCode: 0x9000,
  }),
  getPubKey: async () => ({
    errorMessage: "",
    publicKey: new Uint8Array(64),
    returnCode: 0x9000,
  }),
  signHash: async () => ({
    errorMessage: "",
    r: new Uint8Array(32),
    returnCode: 0x9000,
    s: new Uint8Array(32),
    v: 1,
  }),
});

describe("serveLedgerBroker", () => {
  test("announces ready and serves a validated command", async () => {
    const fake = createFakeChannel();
    serveLedgerBroker(fake.channel, okClient(), () => undefined);
    expect(fake.posts).toEqual([{ kind: "ready" }]);

    fake.emit({ id: 1, kind: "command", method: "getAppVersion" });
    await tick();
    expect(fake.posts[1]).toEqual({
      id: 1,
      kind: "response",
      ok: true,
      value: { errorMessage: "", major: 2, minor: 4, patch: 0, returnCode: 0x9000 },
    });
  });

  test("serves the read-only OS version command", async () => {
    const fake = createFakeChannel();
    serveLedgerBroker(fake.channel, okClient(), () => undefined);

    fake.emit({ id: 1, kind: "command", method: "getOsVersion" });
    await tick();
    expect(fake.posts[1]).toEqual({
      id: 1,
      kind: "response",
      ok: true,
      value: { targetId: 0x33000004, version: "2.7.1" },
    });
  });

  test("routes key and signing commands and supports explicit detachment", async () => {
    const fake = createFakeChannel();
    const path = ledgerAccountPath(0);
    const detach = serveLedgerBroker(fake.channel, okClient(), () => undefined);

    fake.emit({ id: 1, kind: "command", method: "getPubKey", path });
    await tick();
    expect(fake.posts[1]).toMatchObject({
      id: 1,
      kind: "response",
      ok: true,
      value: { publicKey: new Uint8Array(64), returnCode: 0x9000 },
    });

    fake.emit({ hash: "0x1", id: 2, kind: "command", method: "signHash", path });
    await tick();
    expect(fake.posts[2]).toMatchObject({
      id: 2,
      kind: "response",
      ok: true,
      value: {
        r: new Uint8Array(32),
        returnCode: 0x9000,
        s: new Uint8Array(32),
      },
    });

    detach();
    expect(fake.listeners.size).toBe(0);
  });

  test("ignores malformed paths without touching the device", async () => {
    const fake = createFakeChannel();
    let calls = 0;
    const client = okClient();
    serveLedgerBroker(
      fake.channel,
      {
        ...client,
        getPubKey: async (...args) => {
          calls += 1;
          return client.getPubKey(...args);
        },
      },
      () => undefined,
    );
    fake.emit({ id: 1, kind: "command", method: "getPubKey", path: "m/44'/60'/0'" });
    await tick();
    expect(calls).toBe(0);
    expect(fake.posts).toEqual([{ kind: "ready" }]);
  });

  test("rejects a concurrent operation while the serial device pipe is busy", async () => {
    const fake = createFakeChannel();
    let resolveVersion: (() => void) | undefined;
    const client = okClient();
    serveLedgerBroker(
      fake.channel,
      {
        ...client,
        getAppVersion: () =>
          new Promise((resolve) => {
            resolveVersion = () =>
              resolve({ errorMessage: "", major: 2, minor: 0, patch: 0, returnCode: 0x9000 });
          }),
      },
      () => undefined,
    );
    fake.emit({ id: 1, kind: "command", method: "getAppVersion" });
    fake.emit({
      id: 2,
      kind: "command",
      method: "getPubKey",
      path: ledgerAccountPath(0),
    });
    await tick();
    expect(fake.posts[1]).toEqual({
      error: "device-busy",
      id: 2,
      kind: "response",
      ok: false,
    });
    resolveVersion?.();
    await tick();
  });

  test("maps raw transport failures to a fixed code and never sends their message", async () => {
    const fake = createFakeChannel();
    const client = okClient();
    serveLedgerBroker(
      fake.channel,
      {
        ...client,
        getAppVersion: async () => {
          throw new Error("DisconnectedDevice secret-library-detail");
        },
      },
      () => undefined,
    );
    fake.emit({ id: 1, kind: "command", method: "getAppVersion" });
    await tick();
    expect(fake.posts[1]).toEqual({
      error: "disconnected-mid-sign",
      id: 1,
      kind: "response",
      ok: false,
    });
    expect(JSON.stringify(fake.posts)).not.toContain("secret-library-detail");
  });

  test("detaches and closes once on the exact close command", () => {
    const fake = createFakeChannel();
    let closes = 0;
    serveLedgerBroker(fake.channel, okClient(), () => {
      closes += 1;
    });
    fake.emit({ kind: "close", extra: true });
    expect(closes).toBe(0);
    fake.emit({ kind: "close" });
    fake.emit({ kind: "close" });
    expect(closes).toBe(1);
    expect(fake.listeners.size).toBe(0);
  });
});
