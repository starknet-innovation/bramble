/** Public outcomes returned by explicit Nostr coordination actions. */
export type NostrCoordinationResponse =
  | { readonly nostrPublicKey: string; readonly ok: true }
  | {
      readonly ok: true;
      readonly recipients: number;
      readonly relays: number;
      readonly totalRecipients: number;
    }
  | {
      readonly imported: number;
      readonly intentIds: readonly string[];
      readonly ok: true;
      readonly received: number;
      readonly strk20Key: "conflict" | "held" | "none" | "stored";
    }
  | {
      readonly ok: true;
      readonly state: "absent" | "conflict" | "created" | "held";
    }
  | {
      readonly id: string;
      readonly ok: true;
      readonly phase: "authorization" | "fresh" | "relay";
    }
  | { readonly ok: true; readonly transactionHash: string };
