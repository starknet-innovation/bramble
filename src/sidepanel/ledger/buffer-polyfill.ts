/**
 * Browser `Buffer` polyfill for the Ledger boundary. The `@ledgerhq/*` client
 * libraries (via `bn.js`) reference the Node `Buffer` global at module-eval
 * time, but the side panel runs in a browser context where it is absent —
 * without this the whole panel throws `Buffer is not defined` on load. Imported
 * first from `webhid-impl.js` so it installs a `Buffer` before those libraries
 * evaluate. Scoped to the Ledger boundary; nothing else in the app needs it.
 */
import { Buffer } from "buffer";

(globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
