/**
 * An in-memory Nostr relay and gift-wrap identities for multisig coordination
 * tests. A wrap's content is the application data in clear JSON, so a test can
 * read or forge exactly what Krusty would have authenticated.
 */
import type { NostrApplicationData } from "@bramble/vault/kms-port";
import type { NostrEvent } from "@bramble/wallet-model/nostr";
import type { NostrRelayTransport } from "../../apps/extension/src/background/multisig/nostr-relay";

/** One shared relay, with every sync's relay selection and `since` recorded. */
export const coordinationNetwork = () => {
  const events: NostrEvent[] = [];
  const relaySelections: string[][] = [];
  const sinceValues: number[] = [];
  const seenEventIds: (readonly string[])[] = [];
  const transport: NostrRelayTransport = {
    async publish(eventJson, recipientPublicKey, relayUrls) {
      const event = JSON.parse(eventJson) as NostrEvent;
      if (!event.tags.some((tag) => tag[0] === "p" && tag[1] === recipientPublicKey)) {
        throw new Error("recipient mismatch");
      }
      events.push(event);
      relaySelections.push([...relayUrls]);
      return 1;
    },
    async sync(recipientPublicKey, since, relayUrls, seen) {
      relaySelections.push([...relayUrls]);
      sinceValues.push(since);
      seenEventIds.push([...(seen ?? [])]);
      return events.filter((event) =>
        event.tags.some((tag) => tag[0] === "p" && tag[1] === recipientPublicKey),
      );
    },
  };
  let sequence = 0;
  const identity = (publicKey: string) => ({
    async open(eventJson: string): Promise<NostrApplicationData> {
      const event = JSON.parse(eventJson) as NostrEvent;
      if (!event.tags.some((tag) => tag[0] === "p" && tag[1] === publicKey)) {
        throw new Error("recipient mismatch");
      }
      return JSON.parse(event.content) as NostrApplicationData;
    },
    publicKey,
    transport,
    async wrap(input: {
      readonly content: string;
      readonly identifier: string;
      readonly recipientPublicKey: string;
    }): Promise<string> {
      sequence += 1;
      return JSON.stringify({
        content: JSON.stringify({
          content: input.content,
          identifier: input.identifier,
          senderPublicKey: publicKey,
        }),
        created_at: sequence,
        id: sequence.toString(16).padStart(64, "0"),
        kind: 1_059,
        pubkey: "33".repeat(32),
        sig: "44".repeat(64),
        tags: [["p", input.recipientPublicKey]],
      });
    },
  });
  return {
    identity,
    pushEvent: (event: NostrEvent) => events.push(event),
    relaySelections,
    seenEventIds,
    sinceValues,
  };
};
