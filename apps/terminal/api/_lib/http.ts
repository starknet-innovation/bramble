/** Minimal Vercel-compatible HTTP boundary used by Terminal server functions. */
import type { IncomingMessage, ServerResponse } from "node:http";

/** Request fields consumed by the Terminal's Vercel handlers. */
export type ApiRequest = IncomingMessage & {
  readonly body?: unknown;
  readonly query: Readonly<Record<string, string | readonly string[] | undefined>>;
};

/** Response methods supplied to the Terminal's Vercel handlers. */
export type ApiResponse = ServerResponse & {
  readonly json: (body: unknown) => ApiResponse;
  readonly send: (body: unknown) => ApiResponse;
  readonly status: (status: number) => ApiResponse;
};
