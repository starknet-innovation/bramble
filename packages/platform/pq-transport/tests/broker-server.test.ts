/**
 * The device-owning half of the broker. Its job is to be the last line before
 * bytes from a phone cross a channel, so these tests are about refusal: a reply
 * of the wrong shape, a second command while one is in flight, and a raw error
 * that must never escape as itself.
 */
import { describe, expect, test } from "bun:test";
import {
  type PqBrokerChannel,
  type PqDevice,
  servePqBroker,
} from "@mc-wallet/pq-transport/broker-server";
import { PqRejection } from "@mc-wallet/pq-transport/errors";

const OFFER = "eyJjaGFsbGVuZ2UiOiIweDEifQ";
const PAIRING_REPLY = "eyJkZXZpY2VJZCI6IlBpeGVsIn0";
const SIGNED_REPLY = `0x${"ab".repeat(3309)}`;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createFakeChannel = (): {
  readonly channel: PqBrokerChannel;
  readonly emit: (data: unknown) => void;
  readonly posts: unknown[];
} => {
  const listeners = new Set<(event: MessageEvent<unknown>) => void>();
  const posts: unknown[] = [];
  return {
    channel: {
      addEventListener: (_type, listener) => {
        listeners.add(listener);
      },
      close: () => undefined,
      postMessage: (message) => {
        posts.push(message);
      },
      removeEventListener: (_type, listener) => {
        listeners.delete(listener);
      },
    },
    emit: (data) => {
      for (const listener of [...listeners]) {
        listener({ data } as MessageEvent<unknown>);
      }
    },
    posts,
  };
};

const stubDevice = (overrides: Partial<PqDevice> = {}): PqDevice => ({
  pair: async () => PAIRING_REPLY,
  sign: async () => SIGNED_REPLY,
  ...overrides,
});

describe("pq broker server", () => {
  test("reports ready before anything is asked of the device", () => {
    const fake = createFakeChannel();
    servePqBroker(fake.channel, stubDevice(), () => undefined);

    expect(fake.posts).toEqual([{ kind: "ready" }]);
  });

  test("serves both methods and passes the reply through", async () => {
    const fake = createFakeChannel();
    const offers: string[] = [];
    servePqBroker(
      fake.channel,
      stubDevice({
        pair: async (offer) => {
          offers.push(offer);
          return PAIRING_REPLY;
        },
      }),
      () => undefined,
    );

    fake.emit({ id: 1, kind: "command", method: "pair", offer: OFFER });
    await tick();
    expect(offers).toEqual([OFFER]);
    expect(fake.posts[1]).toEqual({ id: 1, kind: "response", ok: true, value: PAIRING_REPLY });

    fake.emit({ envelope: OFFER, id: 2, kind: "command", method: "sign" });
    await tick();
    expect(fake.posts[2]).toEqual({ id: 2, kind: "response", ok: true, value: SIGNED_REPLY });
  });

  test("refuses a reply of the wrong shape for the command it answers", async () => {
    const fake = createFakeChannel();
    // A well-formed pairing reply is NOT a well-formed signing reply, and the
    // command is what decides which one is expected.
    servePqBroker(fake.channel, stubDevice({ sign: async () => PAIRING_REPLY }), () => undefined);

    fake.emit({ envelope: OFFER, id: 1, kind: "command", method: "sign" });
    await tick();

    expect(fake.posts[1]).toEqual({
      error: "malformed-reply",
      id: 1,
      kind: "response",
      ok: false,
    });
  });

  test("refuses a second command while one is in flight rather than queueing it", async () => {
    const fake = createFakeChannel();
    let release: (() => void) | undefined;
    servePqBroker(
      fake.channel,
      stubDevice({
        sign: async () => {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return SIGNED_REPLY;
        },
      }),
      () => undefined,
    );

    fake.emit({ envelope: OFFER, id: 1, kind: "command", method: "sign" });
    await tick();
    fake.emit({ envelope: OFFER, id: 2, kind: "command", method: "sign" });
    await tick();

    expect(fake.posts[1]).toEqual({ error: "device-busy", id: 2, kind: "response", ok: false });

    release?.();
    await tick();
    expect(fake.posts[2]).toEqual({ id: 1, kind: "response", ok: true, value: SIGNED_REPLY });
  });

  test("reduces a raw device error to the catalog and keeps a typed one", async () => {
    const fake = createFakeChannel();
    servePqBroker(
      fake.channel,
      stubDevice({
        pair: async () => {
          throw new DOMException("GATT operation failed for unknown reason", "NetworkError");
        },
        sign: async () => {
          throw new PqRejection("device-lost");
        },
      }),
      () => undefined,
    );

    fake.emit({ id: 1, kind: "command", method: "pair", offer: OFFER });
    await tick();
    expect(fake.posts[1]).toEqual({
      error: "unexpected-device-error",
      id: 1,
      kind: "response",
      ok: false,
    });

    fake.emit({ envelope: OFFER, id: 2, kind: "command", method: "sign" });
    await tick();
    expect(fake.posts[2]).toEqual({ error: "device-lost", id: 2, kind: "response", ok: false });
  });

  test("ignores a message that is not a valid command, without answering it", async () => {
    const fake = createFakeChannel();
    let paired = 0;
    servePqBroker(
      fake.channel,
      stubDevice({
        pair: async () => {
          paired += 1;
          return PAIRING_REPLY;
        },
      }),
      () => undefined,
    );

    fake.emit({ id: 1, kind: "command", method: "pair", offer: "not base64url" });
    fake.emit({ id: 1, kind: "command", method: "wipe" });
    fake.emit("close");
    await tick();

    expect(paired).toBe(0);
    expect(fake.posts).toEqual([{ kind: "ready" }]);
  });

  test("close is reported once, and stops the broker answering", async () => {
    const fake = createFakeChannel();
    let closes = 0;
    servePqBroker(fake.channel, stubDevice(), () => {
      closes += 1;
    });

    fake.emit({ kind: "close" });
    fake.emit({ kind: "close" });
    fake.emit({ envelope: OFFER, id: 1, kind: "command", method: "sign" });
    await tick();

    expect(closes).toBe(1);
    expect(fake.posts).toEqual([{ kind: "ready" }]);
  });
});
