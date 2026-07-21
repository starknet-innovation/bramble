/**
 * Hand-written type surface for the runtime-only `webhid-impl.js` boundary. It
 * exposes ONLY the tiny WebHID/StarknetClient surface this wallet uses, in terms
 * of local types, so no typed module ever references the vendored Ledger `.d.ts`
 * (which does not compile under the repo's pinned `skipLibCheck: false`). This
 * declaration is the trust boundary between the type-checked flow and the opaque
 * hardware library; the runtime `.js` is what actually executes.
 */
import type { LedgerDeviceClient } from "./client";

/**
 * An open WebHID transport handle. Opaque to the flow: the only method callers
 * need is `close`, used to release the device on teardown. Constructing the
 * device client from it is done via {@link newStarknetClient}.
 */
export type LedgerTransport = { close(): Promise<void> };

/**
 * Shows the native WebHID device picker and opens the chosen device. MUST be
 * called from a user gesture; rejects (never resolves null) if none is chosen.
 */
export function requestTransportRaw(): Promise<LedgerTransport>;

/**
 * Reopens an already-granted device without a prompt. Resolves null when no
 * granted device is connected, so the caller can fall back to a gesture-gated
 * {@link requestTransportRaw}.
 */
export function openConnectedTransportRaw(): Promise<LedgerTransport | null>;

/**
 * Wraps an open transport in the Starknet APDU client, exposed through the
 * structural {@link LedgerDeviceClient} so the rest of the flow stays
 * hardware-agnostic and testable.
 */
export function newStarknetClient(transport: LedgerTransport): LedgerDeviceClient;
