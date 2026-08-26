/** Public outcomes returned by explicit Nostr coordination actions. */
export type NostrCoordinationResponse =
  | { readonly nostrPublicKey: string; readonly ok: true }
  | { readonly ok: true; readonly recipients: number; readonly relays: number }
  | { readonly imported: number; readonly ok: true; readonly received: number };
