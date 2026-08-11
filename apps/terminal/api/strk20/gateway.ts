import type { ApiRequest, ApiResponse } from "../_lib/http.js";
import {
  authorizeOrigin,
  AVNU_PAYMASTER_URL,
  isRecord,
  PRIVATE_SWAP_FEE_TOKEN,
  PRIVACY_POOL_ADDRESS,
  reject,
  serviceUrl,
} from "../_lib/security.js";

export const config = {
  api: { bodyParser: false },
  maxDuration: 120,
};

type Service = "discovery" | "paymaster" | "prover";

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DISCOVERY_PATHS = new Set([
  "",
  "health",
  "ohttp-keys",
  "v1/history",
  "v1/sync/incoming_state",
  "v1/sync/outgoing_state",
  "v1/sync/preflight_check",
]);

const readRoute = (request: ApiRequest): { path: string; service: Service } | null => {
  const service = request.query.service;
  const path = request.query.path;
  const pathParts = Array.isArray(path) ? path : typeof path === "string" ? [path] : [];
  if (service !== "discovery" && service !== "paymaster" && service !== "prover") {
    return null;
  }
  if (pathParts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return null;
  }
  return { path: pathParts.join("/"), service };
};

const contentType = (request: ApiRequest): string =>
  String(request.headers["content-type"] ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? "";

const readBody = async (request: ApiRequest): Promise<Uint8Array<ArrayBuffer> | null> => {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
    length += bytes.byteLength;
    if (length > MAX_REQUEST_BYTES) {
      return null;
    }
    chunks.push(bytes);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

const isAllowedRequest = (
  service: Service,
  path: string,
  method: string | undefined,
  type: string,
): boolean => {
  if (service === "discovery") {
    if (!DISCOVERY_PATHS.has(path)) {
      return false;
    }
    return (
      (method === "GET" && (path === "health" || path === "ohttp-keys")) ||
      (method === "POST" &&
        ((path === "" && type === "message/ohttp-req") ||
          (path.startsWith("v1/") && type === "application/json")))
    );
  }
  if (service === "prover") {
    return (
      (method === "GET" && path === "ohttp-keys") ||
      (method === "POST" &&
        path === "" &&
        (type === "application/json" || type === "message/ohttp-req"))
    );
  }
  return method === "POST" && path === "" && type === "application/json";
};

const paymasterBodyAllowed = (body: Uint8Array): boolean => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!isRecord(value) || !isRecord(value["params"])) {
      return false;
    }
    const method = value["method"];
    if (method !== "paymaster_buildTransaction" && method !== "paymaster_executeTransaction") {
      return false;
    }
    const transaction = value["params"]["transaction"];
    const parameters = value["params"]["parameters"];
    if (!isRecord(transaction) || !isRecord(transaction["apply_action"])) {
      return false;
    }
    if (
      !isRecord(parameters) ||
      parameters["version"] !== "0x1" ||
      !isRecord(parameters["fee_mode"]) ||
      parameters["fee_mode"]["mode"] !== "sponsored_private" ||
      typeof parameters["fee_mode"]["pool_fee_token"] !== "string" ||
      BigInt(parameters["fee_mode"]["pool_fee_token"]) !== BigInt(PRIVATE_SWAP_FEE_TOKEN)
    ) {
      return false;
    }
    const applyAction = transaction["apply_action"];
    const target =
      method === "paymaster_buildTransaction"
        ? applyAction["pool_address"]
        : isRecord(applyAction["apply_actions_call"])
          ? applyAction["apply_actions_call"]["to"]
          : null;
    return typeof target === "string" && BigInt(target) === BigInt(PRIVACY_POOL_ADDRESS);
  } catch {
    return false;
  }
};

const upstreamFor = (service: Service): string | null => {
  if (service === "discovery") {
    return serviceUrl("STRK20_DISCOVERY_UPSTREAM");
  }
  if (service === "prover") {
    return serviceUrl("STRK20_PROVER_UPSTREAM");
  }
  return serviceUrl("STRK20_PAYMASTER_UPSTREAM", AVNU_PAYMASTER_URL);
};

const copyResponse = async (
  upstream: Response,
  response: ApiResponse,
): Promise<ApiResponse> => {
  if (!upstream.ok) {
    return reject(response, 502, "upstream_unavailable");
  }
  const type = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (
    type !== "application/json" &&
    type !== "application/ohttp-keys" &&
    type !== "message/ohttp-res"
  ) {
    return reject(response, 502, "invalid_upstream_response");
  }
  const declaredLength = upstream.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^[0-9]+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)
  ) {
    return reject(response, 502, "upstream_response_too_large");
  }
  const reader = upstream.body?.getReader();
  if (!reader) {
    return reject(response, 502, "invalid_upstream_response");
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
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return reject(response, 502, "upstream_response_too_large");
      }
      chunks.push(value);
    }
  } catch {
    return reject(response, 502, "upstream_unavailable");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  response.status(upstream.status);
  response.setHeader("Content-Type", type);
  return response.send(Buffer.from(bytes));
};

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
): Promise<ApiResponse | void> {
  if (!authorizeOrigin(request, response, "extension")) {
    return;
  }
  const route = readRoute(request);
  const type = contentType(request);
  if (!route || !isAllowedRequest(route.service, route.path, request.method, type)) {
    return reject(response, 404, "route_not_allowed");
  }
  const upstreamBase = upstreamFor(route.service);
  if (!upstreamBase) {
    return reject(response, 503, "service_not_configured");
  }
  const body = request.method === "POST" ? await readBody(request) : undefined;
  if (body === null) {
    return reject(response, 413, "request_too_large");
  }
  if (route.service === "paymaster" && body && !paymasterBodyAllowed(body)) {
    return reject(response, 400, "invalid_paymaster_request");
  }
  const accept =
    route.path === "ohttp-keys"
      ? "application/ohttp-keys"
      : type === "message/ohttp-req"
        ? "message/ohttp-res"
        : "application/json";
  const headers = new Headers({ Accept: accept });
  if (body) {
    headers.set("Content-Type", type);
  }
  const paymasterApiKey = process.env.AVNU_PAYMASTER_API_KEY;
  if (route.service === "paymaster" && paymasterApiKey) {
    headers.set("x-paymaster-api-key", paymasterApiKey);
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${upstreamBase}${route.path ? `/${route.path}` : ""}`, {
      body,
      headers,
      method: request.method,
      redirect: "error",
      signal: AbortSignal.timeout(route.service === "prover" ? 110_000 : 25_000),
    });
  } catch {
    return reject(response, 502, "upstream_unavailable");
  }
  return copyResponse(upstream, response);
}
