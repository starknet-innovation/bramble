import type { StreamStatus } from "./ws";

const BRIDGE_STATUS_KEY = "brambleExtendedBridge";

/** Encodes an internal dev-bridge status frame for the browser stream client. */
export const encodeBridgeStatus = (status: StreamStatus): string =>
  JSON.stringify({ [BRIDGE_STATUS_KEY]: status });

/** Reads a dev-bridge status frame, returning null for normal exchange data. */
export const parseBridgeStatus = (value: unknown): StreamStatus | null => {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const status = parsed[BRIDGE_STATUS_KEY];
    return status === "connecting" || status === "open" || status === "closed" ? status : null;
  } catch {
    return null;
  }
};

/** Identifies the same-origin development bridge URL. */
export const isExtendedBridgeUrl = (value: string): boolean => {
  try {
    return new URL(value).pathname.startsWith("/proxy/extended-ws/");
  } catch {
    return false;
  }
};
