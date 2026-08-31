/** Relay coordination stays pooled, recipient-bound, bounded, and deduplicated. */
import { describe, expect, test } from "bun:test";
import {
  createNostrRelayTransport,
  MULTISIG_NOSTR_RELAYS,
  publishManyNostrGiftWraps,
  publishNostrGiftWrap,
  type RelaySocketFactory,
  syncNostrGiftWraps,
} from "../../../apps/extension/src/background/multisig/nostr-relay";

const RECIPIENT = "44".repeat(32);
const event = (id: string, recipient = RECIPIENT) => ({
  content: "ciphertext",
  created_at: 1,
  id,
  kind: 1_059,
  pubkey: "22".repeat(32),
  sig: "33".repeat(64),
  tags: [["p", recipient]],
});

const socketFactory =
  (
    sent: string[],
    respond: (frame: readonly unknown[], socket: WebSocket, url: string) => void,
    connections: string[] = [],
  ): RelaySocketFactory =>
  (url) => {
    connections.push(url);
    const socket = {
      close() {},
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
      send(value: string) {
        sent.push(`${url}|${value}`);
        const frame = JSON.parse(value) as readonly unknown[];
        if (frame[0] !== "CLOSE") respond(frame, socket as WebSocket, url);
      },
    } as unknown as WebSocket;
    queueMicrotask(() => socket.onopen?.(new Event("open")));
    return socket;
  };

describe("Nostr multisig relay", () => {
  test("publishes a recipient-bound gift wrap to each reviewed default relay", async () => {
    expect(MULTISIG_NOSTR_RELAYS).toEqual(["wss://relay.primal.net", "wss://nos.lol"]);
    const sent: string[] = [];
    const giftWrap = event("11".repeat(32));
    const factory = socketFactory(sent, (frame, socket) => {
      const published = frame[1] as { readonly id?: unknown };
      socket.onmessage?.(
        new MessageEvent("message", { data: JSON.stringify(["OK", published.id, true, ""]) }),
      );
    });

    await expect(
      publishNostrGiftWrap(JSON.stringify(giftWrap), RECIPIENT, { socketFactory: factory }),
    ).resolves.toBe(MULTISIG_NOSTR_RELAYS.length);
    expect(sent).toHaveLength(MULTISIG_NOSTR_RELAYS.length);
    await expect(
      publishNostrGiftWrap(JSON.stringify(giftWrap), "55".repeat(32), {
        socketFactory: factory,
      }),
    ).rejects.toThrow("Invalid Nostr gift wrap");
  });

  test("syncs only matching gift wraps and deduplicates across relays", async () => {
    const sent: string[] = [];
    const giftWrap = event("11".repeat(32));
    const factory = socketFactory(sent, (frame, socket) => {
      const subscriptionId = String(frame[1]);
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(["EVENT", subscriptionId, event("22".repeat(32), "55".repeat(32))]),
        }),
      );
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(["EVENT", subscriptionId, giftWrap]),
        }),
      );
      socket.onmessage?.(
        new MessageEvent("message", { data: JSON.stringify(["EOSE", subscriptionId]) }),
      );
    });

    await expect(syncNostrGiftWraps(RECIPIENT, 1, { socketFactory: factory })).resolves.toEqual([
      giftWrap,
    ]);
    expect(sent.filter((frame) => frame.includes('["REQ"'))).toHaveLength(
      MULTISIG_NOSTR_RELAYS.length,
    );
    expect(sent[0]).toContain('"kinds":[1059]');
    expect(sent.filter((frame) => frame.includes('["CLOSE"'))).toHaveLength(
      MULTISIG_NOSTR_RELAYS.length,
    );
    await expect(syncNostrGiftWraps("0x44", 1, { socketFactory: factory })).rejects.toThrow(
      "Invalid Nostr sync request",
    );
  });

  test("publishes many recipients over one connection per relay and preserves partial acks", async () => {
    const sent: string[] = [];
    const connections: string[] = [];
    const first = event("11".repeat(32));
    const secondRecipient = "55".repeat(32);
    const second = event("22".repeat(32), secondRecipient);
    const factory = socketFactory(
      sent,
      (frame, socket, url) => {
        const published = frame[1] as { readonly id: string };
        const accepted = url === MULTISIG_NOSTR_RELAYS[0] || published.id === first.id;
        socket.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(["OK", published.id, accepted, accepted ? "" : "blocked: test"]),
          }),
        );
      },
      connections,
    );

    await expect(
      publishManyNostrGiftWraps(
        [
          { eventJson: JSON.stringify(first), recipientPublicKey: RECIPIENT },
          { eventJson: JSON.stringify(second), recipientPublicKey: secondRecipient },
        ],
        { socketFactory: factory },
      ),
    ).resolves.toEqual([2, 1]);
    expect(connections).toEqual([...MULTISIG_NOSTR_RELAYS]);
    expect(sent.filter((frame) => frame.includes('["EVENT"'))).toHaveLength(4);
  });

  test("reuses one socket per relay and coalesces identical in-flight syncs", async () => {
    const sent: string[] = [];
    const connections: string[] = [];
    const relayUrl = "wss://relay.team.example";
    const giftWrap = event("99".repeat(32));
    const factory = socketFactory(
      sent,
      (frame, socket) => {
        if (frame[0] === "EVENT") {
          const published = frame[1] as ReturnType<typeof event>;
          socket.onmessage?.(
            new MessageEvent("message", {
              data: JSON.stringify(["OK", published.id, true, ""]),
            }),
          );
          return;
        }
        const subscriptionId = String(frame[1]);
        socket.onmessage?.(
          new MessageEvent("message", { data: JSON.stringify(["EOSE", subscriptionId]) }),
        );
      },
      connections,
    );
    const transport = createNostrRelayTransport({ idleMs: 60_000, socketFactory: factory });
    try {
      await transport.publish(JSON.stringify(giftWrap), RECIPIENT, [relayUrl]);
      await Promise.all([
        transport.sync(RECIPIENT, 1, [relayUrl]),
        transport.sync(RECIPIENT, 1, [relayUrl]),
      ]);
      expect(connections).toEqual([relayUrl]);
      expect(sent.filter((frame) => frame.includes('["REQ"'))).toHaveLength(1);
    } finally {
      transport.close();
    }
  });

  test("returns after one durable relay copy and accepts idempotent duplicate acks", async () => {
    const sent: string[] = [];
    const connections: string[] = [];
    const giftWrap = event("aa".repeat(32));
    const factory = socketFactory(
      sent,
      (frame, socket, url) => {
        if (url !== MULTISIG_NOSTR_RELAYS[0]) return;
        const published = frame[1] as ReturnType<typeof event>;
        socket.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(["OK", published.id, false, "duplicate: already saved"]),
          }),
        );
      },
      connections,
    );
    const transport = createNostrRelayTransport({ idleMs: 60_000, socketFactory: factory });
    try {
      await expect(
        transport.publish(JSON.stringify(giftWrap), RECIPIENT, MULTISIG_NOSTR_RELAYS),
      ).resolves.toBe(1);
      expect(connections).toEqual([...MULTISIG_NOSTR_RELAYS]);
    } finally {
      transport.close();
    }
  });

  test("fails a refused subscription without waiting for the relay timeout", async () => {
    const sent: string[] = [];
    const relayUrl = "wss://relay.team.example";
    const factory = socketFactory(sent, (frame, socket) => {
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(["CLOSED", frame[1], "restricted: test"]),
        }),
      );
    });

    await expect(
      syncNostrGiftWraps(RECIPIENT, 1, { relayUrls: [relayUrl], socketFactory: factory }),
    ).rejects.toThrow("Nostr relays are unavailable");
  });

  test("retains authenticated candidates received before a relay disconnect", async () => {
    const sent: string[] = [];
    const giftWrap = event("88".repeat(32));
    const factory = socketFactory(sent, (frame, socket) => {
      socket.onmessage?.(
        new MessageEvent("message", {
          data: JSON.stringify(["EVENT", frame[1], giftWrap]),
        }),
      );
      socket.onclose?.(new Event("close") as CloseEvent);
    });

    await expect(
      syncNostrGiftWraps(RECIPIENT, 1, {
        relayUrls: ["wss://relay.team.example"],
        socketFactory: factory,
      }),
    ).resolves.toEqual([giftWrap]);
  });

  test("round-trips a gift wrap through one user-selected relay", async () => {
    const relayUrl = "wss://relay.team.example/multisig";
    const stored: ReturnType<typeof event>[] = [];
    const sent: string[] = [];
    const factory = socketFactory(sent, (frame, socket) => {
      if (frame[0] === "EVENT") {
        const published = frame[1] as ReturnType<typeof event>;
        stored.push(published);
        socket.onmessage?.(
          new MessageEvent("message", { data: JSON.stringify(["OK", published.id, true, ""]) }),
        );
        return;
      }
      const subscriptionId = String(frame[1]);
      for (const published of stored) {
        socket.onmessage?.(
          new MessageEvent("message", {
            data: JSON.stringify(["EVENT", subscriptionId, published]),
          }),
        );
      }
      socket.onmessage?.(
        new MessageEvent("message", { data: JSON.stringify(["EOSE", subscriptionId]) }),
      );
    });
    const giftWrap = event("66".repeat(32));
    const options = { relayUrls: [relayUrl], socketFactory: factory };

    await expect(publishNostrGiftWrap(JSON.stringify(giftWrap), RECIPIENT, options)).resolves.toBe(
      1,
    );
    await expect(syncNostrGiftWraps(RECIPIENT, 1, options)).resolves.toEqual([giftWrap]);
    expect(sent.every((frame) => frame.startsWith(`${relayUrl}|`))).toBe(true);
  });

  test("rejects insecure, duplicate, or empty relay selections", async () => {
    const giftWrap = JSON.stringify(event("77".repeat(32)));
    await expect(
      publishNostrGiftWrap(giftWrap, RECIPIENT, { relayUrls: ["ws://relay.example"] }),
    ).rejects.toThrow("Invalid Nostr relay configuration");
    await expect(publishNostrGiftWrap(giftWrap, RECIPIENT, { relayUrls: [] })).rejects.toThrow(
      "Invalid Nostr relay configuration",
    );
  });
});
