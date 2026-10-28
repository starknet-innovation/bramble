/** Scripted relay sockets for the Nostr relay transport tests; never a production dependency. */
import type { RelaySocketFactory } from "../../apps/extension/src/background/multisig/nostr-relay";

export const RECIPIENT = "44".repeat(32);
export const event = (id: string, recipient = RECIPIENT) => ({
  content: "ciphertext",
  created_at: 1,
  id,
  kind: 1_059,
  pubkey: "22".repeat(32),
  sig: "33".repeat(64),
  tags: [["p", recipient]],
});

export const socketFactory =
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
