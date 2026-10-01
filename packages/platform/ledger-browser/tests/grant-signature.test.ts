/**
 * Grant-tab signature replies (audit #174). The pinned `@ledgerhq/hw-app-starknet`
 * `signHash` returns `{ errorMessage, returnCode, r, s, v }` on every branch, so
 * the side-panel proxy must accept the recovery byte, keep on-device refusals
 * classifiable, and still fail closed on anything else. The last test runs the
 * shipped client over a fake APDU transport through the real broker, so a
 * library bump that changes the reply shape fails here.
 */
import { describe, expect, test } from "bun:test";
import { type LedgerBrokerChannel, serveLedgerBroker } from "@bramble/ledger-browser/broker-server";
import {
  type GrantBrowser,
  type GrantClientChannel,
  requestDeviceGrant,
} from "@bramble/ledger-browser/grant-window";
import { newStarknetClient } from "@bramble/ledger-browser/webhid";
import { ledgerSignHashOnDevice } from "@bramble/ledger-protocol/client";
import type { LedgerDeviceSession } from "@bramble/ledger-protocol/session";
import { ledgerAccountPath } from "@bramble/wallet-model/ledger-path";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
const PATH = ledgerAccountPath(0);

type Listener = (event: MessageEvent<unknown>) => void;

// In-memory BroadcastChannel pair with structured cloning, like the real channel.
const channelBus = (): (() => GrantClientChannel & LedgerBrokerChannel) => {
  const ends: Set<Listener>[] = [];
  return () => {
    const listeners = new Set<Listener>();
    ends.push(listeners);
    return {
      addEventListener: (_type: "message", listener: Listener) => {
        listeners.add(listener);
      },
      close: () => undefined,
      postMessage: (message: unknown) => {
        const data = structuredClone(message);
        queueMicrotask(() => {
          for (const end of ends) {
            if (end === listeners) continue;
            for (const listener of end) listener({ data } as MessageEvent<unknown>);
          }
        });
      },
      removeEventListener: (_type: "message", listener: Listener) => {
        listeners.delete(listener);
      },
    };
  };
};

const browser: GrantBrowser = {
  runtime: { getURL: (path) => `chrome-extension://fake-id/${path}` },
  tabs: {
    create: async () => ({ id: 7 }),
    get: async (tabId) => ({ id: tabId }),
    onRemoved: { addListener: () => undefined, removeListener: () => undefined },
    remove: async () => undefined,
  },
};

/** Opens a grant session whose broker answers `signHash` through `signHash`. */
const openSession = async (
  signHash: (path: string, hash: string) => Promise<unknown>,
): Promise<LedgerDeviceSession> => {
  const make = channelBus();
  const panelEnd = make();
  const tabEnd = make();
  const client = {
    getAppVersion: async () => ({
      errorMessage: "",
      major: 2,
      minor: 4,
      patch: 0,
      returnCode: 0x9000,
    }),
    getOsVersion: async () => ({ targetId: 0x33000004, version: "2.7.1" }),
    getPubKey: async () => ({
      errorMessage: "",
      publicKey: new Uint8Array(64),
      returnCode: 0x9000,
    }),
    signHash,
  };
  const pending = requestDeviceGrant(browser, {
    channel: () => panelEnd,
    sessionId: () => SESSION_ID,
    timeout: { ms: 120_000, schedule: () => () => undefined },
  });
  serveLedgerBroker(tabEnd, client as never, () => undefined);
  tabEnd.postMessage({ kind: "ready" });
  return pending;
};

const bytes = (length: number, last: number): Uint8Array => {
  const out = new Uint8Array(length);
  out[length - 1] = last;
  return out;
};

describe("grant-tab signHash replies", () => {
  test("accepts the library's five-key success reply and drops v", async () => {
    const session = await openSession(async () => ({
      errorMessage: "No errors",
      r: bytes(32, 7),
      returnCode: 0x9000,
      s: bytes(32, 9),
      v: 1,
    }));
    const signature = await session.client.signHash(PATH, "0x1234");
    expect(Object.keys(signature).sort()).toEqual(["errorMessage", "r", "returnCode", "s"]);
    await expect(ledgerSignHashOnDevice(session.client, PATH, "0x1234")).resolves.toEqual({
      r: "0x7",
      s: "0x9",
    });
    await session.close();
  });

  test("accepts a present-but-undefined v from a 65-byte device reply", async () => {
    const session = await openSession(async () => ({
      errorMessage: "",
      r: bytes(32, 7),
      returnCode: 0x9000,
      s: bytes(32, 9),
      v: undefined,
    }));
    await expect(ledgerSignHashOnDevice(session.client, PATH, "0x1")).resolves.toEqual({
      r: "0x7",
      s: "0x9",
    });
    await session.close();
  });

  test("keeps an on-device rejection and a blind-signing refusal classifiable", async () => {
    for (const [returnCode, code] of [
      [0x6e04, "rejected-on-device"],
      [0x6f00, "blind-signing-disabled"],
    ] as const) {
      const session = await openSession(async () => ({
        errorMessage: "refused",
        r: new Uint8Array(0),
        returnCode,
        s: new Uint8Array(0),
        v: 0,
      }));
      await expect(ledgerSignHashOnDevice(session.client, PATH, "0x1")).rejects.toMatchObject({
        code,
      });
      await session.close();
    }
  });

  test("still fails closed on unknown keys, a bad v, or short signature bytes", async () => {
    const base = { errorMessage: "", r: bytes(32, 7), returnCode: 0x9000, s: bytes(32, 9) };
    for (const reply of [
      { ...base, h: 1, v: 1 },
      { ...base, v: 1.5 },
      { ...base, v: 256 },
      { ...base, v: "1" },
      { ...base, r: bytes(31, 7), v: 1 },
      { ...base, s: "0x9", v: 1 },
    ]) {
      const session = await openSession(async () => reply);
      await expect(session.client.signHash(PATH, "0x1")).rejects.toMatchObject({
        code: "unexpected-device-error",
      });
      await session.close();
    }
  });
});

// Fake APDU transport emulating the Starknet app; only the device is faked.
// The client is the production wrapper around the pinned StarknetClient.
const deviceTransport = (rejectSign: boolean) => ({
  close: async (): Promise<void> => undefined,
  send: async (_cla: number, ins: number, p1: number): Promise<Buffer> => {
    if (ins === 2 && p1 === 0) return Buffer.from([0x90, 0x00]);
    if (ins === 2 && p1 === 1) {
      if (rejectSign) return Buffer.from([0x6e, 0x04]);
      const out = new Uint8Array(1 + 32 + 32 + 1 + 2);
      out[0] = 0x41;
      out[32] = 0x07;
      out[64] = 0x09;
      out[65] = 0x01;
      out[66] = 0x90;
      out[67] = 0x00;
      return Buffer.from(out);
    }
    return Buffer.from([0x6e, 0x01]);
  },
});

describe("pinned StarknetClient through the grant broker", () => {
  test("signs and reports an on-device rejection with the shipped reply shape", async () => {
    const approve = newStarknetClient(deviceTransport(false));
    const approved = await openSession((path, hash) => approve.signHash(path, hash));
    await expect(ledgerSignHashOnDevice(approved.client, PATH, "0x1234")).resolves.toEqual({
      r: "0x7",
      s: "0x9",
    });
    await approved.close();

    const reject = newStarknetClient(deviceTransport(true));
    const rejected = await openSession((path, hash) => reject.signHash(path, hash));
    await expect(ledgerSignHashOnDevice(rejected.client, PATH, "0x1234")).rejects.toMatchObject({
      code: "rejected-on-device",
    });
    await rejected.close();
  });
});
