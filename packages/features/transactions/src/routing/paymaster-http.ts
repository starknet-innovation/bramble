/**
 * Deadline and response bound shared by every paymaster client in the wallet:
 * the private relay and gasless fees. One pair, so the two transports cannot
 * drift. The deadline must end before the gateway's own paymaster deadline
 * (`PAYMASTER_UPSTREAM_TIMEOUT_MS` in `apps/terminal/api/_lib/upstream-deadlines.ts`,
 * pinned by a conformance test).
 */

/** The injected transport both paymaster entry points accept. */
export type PaymasterHttp = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * This client's deadline on one relay request. It must end before the gateway
 * gives up, so a slow relay surfaces as this deadline rather than as a
 * gateway status (Sherlock 159).
 */
export const PAYMASTER_TIMEOUT_MS = 20_000;

/** Largest paymaster response body this client will read. */
const PAYMASTER_MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * Reads a paymaster response up to {@link PAYMASTER_MAX_RESPONSE_BYTES}.
 * Returns null when the body is missing, oversized, or cut off — the caller
 * decides whether that is a lost broadcast.
 */
export const readBoundedPaymasterResponse = async (response: Response): Promise<string | null> => {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > PAYMASTER_MAX_RESPONSE_BYTES)
  ) {
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.byteLength;
      if (length > PAYMASTER_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};
