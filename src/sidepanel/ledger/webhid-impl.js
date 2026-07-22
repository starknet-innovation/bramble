/**
 * Runtime-only WebHID boundary: the single place the concrete
 * `@ledgerhq/hw-transport-webhid` transport and `@ledgerhq/hw-app-starknet`
 * client are imported. It is a plain `.js` module (not covered by the pinned
 * `tsconfig` `include`, which is `*.ts` only) precisely so the vendored Ledger
 * `.d.ts` files are never pulled into the type-checked program: those bundled
 * declarations do not compile under this repo's pinned `skipLibCheck: false` and
 * `types: ["bun-types"]`. All typed logic (error mapping, availability gating,
 * device APDU handling) lives in the sibling `.ts` modules and consumes these
 * exports through the hand-written `webhid-impl.d.ts` surface. Bun bundles this
 * file into the side panel at build time; tsc ignores it.
 *
 * This module holds no logic and swallows nothing — every failure propagates to
 * `transport.ts`, which maps it to a typed `LedgerRejection` (fail closed).
 */
// Import first: installs the `Buffer` global before the Ledger libraries below
// evaluate (they reference it at module-eval time and the browser has none).
import "./buffer-polyfill";

import { StarknetClient } from "@ledgerhq/hw-app-starknet";
import TransportWebHID from "@ledgerhq/hw-transport-webhid";

export const requestTransportRaw = () => TransportWebHID.request();

export const openConnectedTransportRaw = () => TransportWebHID.openConnected();

export const newStarknetClient = (transport) => new StarknetClient(transport);
