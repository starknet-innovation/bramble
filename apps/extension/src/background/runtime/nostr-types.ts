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
  | { readonly ok: true; readonly transactionHash: string }
  | {
      readonly authorizations: readonly {
        readonly amount: string;
        readonly id: string;
        readonly kind: "deposit" | "register" | "transfer" | "withdraw";
        readonly recipient?: string;
        readonly summary: string;
        readonly symbol: string;
        readonly youSigned: boolean;
      }[];
      readonly balances: readonly {
        readonly balance: string;
        readonly formatted: string;
        readonly symbol: string;
        readonly token: string;
        readonly tokenId: string;
      }[];
      readonly ok: true;
    };
