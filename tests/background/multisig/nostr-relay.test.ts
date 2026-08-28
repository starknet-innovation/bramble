/** One-shot relay coordination stays recipient-bound, bounded, and deduplicated. */
import { describe, expect, test } from "bun:test";
import {
  MULTISIG_NOSTR_RELAYS,
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
    respond: (frame: readonly unknown[], socket: WebSocket) => void,
  ): RelaySocketFactory =>
  (url) => {
    const socket = {
      close() {},
      onclose: null,
      onerror: null,
      onmessage: null,
      onopen: null,
      send(value: string) {
        sent.push(`${url}|${value}`);
        respond(JSON.parse(value) as readonly unknown[], socket as WebSocket);
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
    expect(sent).toHaveLength(MULTISIG_NOSTR_RELAYS.length);
    expect(sent[0]).toContain('"kinds":[1059]');
    await expect(syncNostrGiftWraps("0x44", 1, { socketFactory: factory })).rejects.toThrow(
      "Invalid Nostr sync request",
    );
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
