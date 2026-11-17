/**
 * Request policy for the local STRK20 development gateway
 * (`scripts/dev-strk20-gateway.ts`), kept here so it is type-checked and
 * tested with the rest of the terminal.
 *
 * The dev gateway holds a developer's paymaster credential and vouches for its
 * callers to the deployed gateway, so it must decide two things the browser
 * cannot decide for it: which callers may use it (Sherlock 244), and which
 * upstream URL a request path may reach (Sherlock 199). Both answers fail
 * closed: an unrecognised caller or path is refused, never forwarded.
 */

// Path prefix of the paymaster leg, without a trailing slash.
const DEV_GATEWAY_PAYMASTER_PREFIX = "/api/strk20/paymaster";

// The production gateway's own segment grammar (`api/strk20/gateway.ts`): no
// dots, slashes, or percent escapes, so a segment can only ever name a path.
const PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

// A Chrome extension id, or a Firefox per-install extension UUID. A website can
// never present either origin.
const EXTENSION_ORIGIN =
  /^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Who sent a request to the dev gateway, or that it must be refused. */
export type DevGatewayCaller =
  | { readonly allowed: false }
  | { readonly allowed: true; readonly origin: string | null };

/**
 * Admits only a locally loaded extension. A request that names an origin must
 * name an extension origin; one that names none must carry the privileged
 * extension Fetch-Metadata shape (`Sec-Fetch-Site: none`, no Referer), which
 * a web page's subresource or navigation request never has. Every other
 * caller, including a page on a localhost dev server, is refused, because the
 * gateway re-signs what it forwards with the extension's privileged shape.
 */
export const devGatewayCaller = (headers: Headers): DevGatewayCaller => {
  const origin = headers.get("origin");
  if (origin !== null) {
    return EXTENSION_ORIGIN.test(origin) ? { allowed: true, origin } : { allowed: false };
  }
  const privileged =
    headers.get("referer") === null &&
    headers.get("sec-fetch-site") === "none" &&
    headers.get("sec-fetch-mode") === "cors" &&
    headers.get("sec-fetch-dest") === "empty";
  return privileged ? { allowed: true, origin: null } : { allowed: false };
};

/**
 * CORS headers for an admitted caller: the caller's own extension origin, or
 * none when the request carried no origin (a privileged extension fetch, which
 * CORS does not apply to).
 */
export const devGatewayCorsHeaders = (caller: {
  readonly origin: string | null;
}): Record<string, string> => ({
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  ...(caller.origin === null ? {} : { "Access-Control-Allow-Origin": caller.origin }),
  Vary: "Origin",
});

/**
 * Whether a path is on the paymaster leg: the prefix itself or a path below
 * it. `/api/strk20/paymasterX` and `/api/strk20/paymaster.example.com/x` are
 * not.
 */
export const isDevGatewayPaymasterPath = (pathname: string): boolean =>
  pathname === DEV_GATEWAY_PAYMASTER_PREFIX ||
  pathname.startsWith(`${DEV_GATEWAY_PAYMASTER_PREFIX}/`);

/**
 * Reads an upstream base URL from configuration. Only a bare `https://` origin
 * (no path, query, or credentials) is accepted, so request paths are always
 * joined below a host this function has fixed.
 */
export const bareHttpsOrigin = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
  return url.protocol === "https:" && url.origin === trimmed ? url.origin : null;
};

/**
 * Builds the relay URL for a paymaster-leg request, or null when the path
 * could reach anything other than `upstreamOrigin`. The credential is attached
 * only to a URL this returns.
 */
export const devGatewayPaymasterUrl = (
  upstreamOrigin: string,
  pathname: string,
  search: string,
): URL | null => {
  if (!isDevGatewayPaymasterPath(pathname)) {
    return null;
  }
  const rest = pathname.slice(DEV_GATEWAY_PAYMASTER_PREFIX.length + 1);
  const segments = rest === "" ? [] : rest.split("/");
  if (!segments.every((segment) => PATH_SEGMENT.test(segment))) {
    return null;
  }
  const url = new URL(`${upstreamOrigin}/${segments.join("/")}${search}`);
  return url.origin === upstreamOrigin ? url : null;
};
