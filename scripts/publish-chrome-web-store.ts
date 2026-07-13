/**
 * Chrome Web Store publish client for the release pipeline.
 *
 * Trust boundary: this is a CI-only network entrypoint. The exported request
 * builders and response interpreters are PURE (no I/O) so they can be unit
 * tested without touching the live API; only `main()` performs `fetch` and file
 * reads. Configuration is sourced exclusively from environment variables set by
 * the release workflow — no secret value is ever hardcoded, logged, or written
 * to an asset.
 *
 * Failure behaviour: if any required credential is missing the client SKIPS
 * cleanly (exit 0) because the Chrome Web Store account/secrets do not exist
 * yet. On a fully-configured run that the API rejects it FAILS CLOSED (non-zero
 * exit) and surfaces the API error, never swallowing a real failure.
 */

/** Google OAuth2 token endpoint that exchanges a refresh token for an access token. */
export const GOOGLE_TOKEN_ENDPOINT = "https://accounts.google.com/o/oauth2/token";

/** Base URL for the Chrome Web Store Publish API. */
export const CWS_API_BASE = "https://www.googleapis.com";

/** Required `x-goog-api-version` header value for the v1.1 Publish API. */
export const CWS_API_VERSION = "2";

/** Publish `status` values that mean the item was accepted (queued for review). */
export const PUBLISH_OK_STATUSES: ReadonlySet<string> = new Set(["OK", "ITEM_PENDING_REVIEW"]);

/** Environment variable names that must all be present for a real publish. */
export const REQUIRED_SECRET_ENV = [
  "CWS_CLIENT_ID",
  "CWS_CLIENT_SECRET",
  "CWS_REFRESH_TOKEN",
  "CWS_EXTENSION_ID",
] as const;

/** Chrome Web Store publish audience. */
export type PublishTarget = "default" | "trustedTesters";

/** Fully-resolved configuration for a real publish run. */
export interface PublishConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly extensionId: string;
  readonly zipPath: string;
  readonly publishTarget: PublishTarget;
  /** Empty string means "no staged rollout"; otherwise an integer 0-100. */
  readonly deployPercentage: string;
  readonly dryRun: boolean;
}

/** Result of resolving configuration from the environment. */
export type ConfigResolution =
  | { readonly configured: false; readonly missing: readonly string[] }
  | { readonly configured: true; readonly config: PublishConfig };

/** A pure description of an HTTP request; `main()` executes it with `fetch`. */
export interface HttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Present only for the token exchange; binary uploads attach bytes at call time. */
  readonly body?: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const parsePublishTarget = (value: string | undefined): PublishTarget | null => {
  if (value === undefined || value === "") {
    return "trustedTesters";
  }
  if (value === "default" || value === "trustedTesters") {
    return value;
  }
  return null;
};

const parseDeployPercentage = (value: string | undefined): string | null => {
  if (value === undefined || value === "") {
    return "";
  }
  if (!/^\d{1,3}$/.test(value)) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return parsed >= 0 && parsed <= 100 ? String(parsed) : null;
};

/**
 * Resolves publish configuration from environment variables. Returns
 * `{ configured: false }` (with the names of the missing secrets) when the
 * Chrome Web Store credentials are absent, so callers can skip cleanly rather
 * than fail. Never returns secret values in the `missing` list — only names.
 */
export const resolveConfig = (
  env: Readonly<Record<string, string | undefined>>,
): ConfigResolution => {
  const missing = REQUIRED_SECRET_ENV.filter((name) => {
    const value = env[name];
    return value === undefined || value === "";
  });
  if (missing.length > 0) {
    return { configured: false, missing };
  }

  const publishTarget = parsePublishTarget(env["CWS_PUBLISH_TARGET"]);
  if (publishTarget === null) {
    throw new Error("CWS_PUBLISH_TARGET must be 'default' or 'trustedTesters'");
  }
  const deployPercentage = parseDeployPercentage(env["CWS_DEPLOY_PERCENTAGE"]);
  if (deployPercentage === null) {
    throw new Error("CWS_DEPLOY_PERCENTAGE must be an integer between 0 and 100");
  }
  const zipPath = env["CWS_ZIP_PATH"];
  if (zipPath === undefined || zipPath === "") {
    throw new Error("CWS_ZIP_PATH must point at the packaged extension zip");
  }

  return {
    configured: true,
    config: {
      clientId: env["CWS_CLIENT_ID"] ?? "",
      clientSecret: env["CWS_CLIENT_SECRET"] ?? "",
      refreshToken: env["CWS_REFRESH_TOKEN"] ?? "",
      extensionId: env["CWS_EXTENSION_ID"] ?? "",
      zipPath,
      publishTarget,
      deployPercentage,
      dryRun: env["CWS_DRY_RUN"] === "true",
    },
  };
};

const authHeaders = (accessToken: string): Record<string, string> => ({
  authorization: `Bearer ${accessToken}`,
  "x-goog-api-version": CWS_API_VERSION,
});

/**
 * Builds the OAuth2 refresh-token exchange request (pure). The body carries the
 * client credentials and long-lived refresh token; the response yields a
 * short-lived access token. Trust boundary: the returned body embeds secrets and
 * must only ever be sent to {@link GOOGLE_TOKEN_ENDPOINT} over HTTPS.
 */
export const buildTokenExchangeRequest = (config: PublishConfig): HttpRequest => {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  }).toString();
  return {
    url: GOOGLE_TOKEN_ENDPOINT,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  };
};

/**
 * Builds the request that uploads the new package to the existing item (pure).
 * The zip bytes are attached by `main()` at call time, not embedded here.
 */
export const buildUploadRequest = (config: PublishConfig, accessToken: string): HttpRequest => ({
  url: `${CWS_API_BASE}/upload/chromewebstore/v1.1/items/${config.extensionId}`,
  method: "PUT",
  headers: authHeaders(accessToken),
});

/**
 * Builds the publish request (pure). `publishTarget` is always set explicitly
 * (never left to the implicit API default); `deployPercentage` is appended only
 * when a staged rollout is configured — its support depends on the account's
 * partial-rollout capability, so it is opt-in, never assumed.
 */
export const buildPublishRequest = (config: PublishConfig, accessToken: string): HttpRequest => {
  const params = new URLSearchParams({ publishTarget: config.publishTarget });
  if (config.deployPercentage !== "") {
    params.set("deployPercentage", config.deployPercentage);
  }
  return {
    url: `${CWS_API_BASE}/chromewebstore/v1.1/items/${config.extensionId}/publish?${params.toString()}`,
    method: "POST",
    headers: { ...authHeaders(accessToken), "content-length": "0" },
  };
};

/**
 * Builds the draft-status read request (pure), used to poll `uploadState` when
 * an upload reports `IN_PROGRESS`. Only `projection=DRAFT` is supported.
 */
export const buildStatusRequest = (config: PublishConfig, accessToken: string): HttpRequest => ({
  url: `${CWS_API_BASE}/chromewebstore/v1.1/items/${config.extensionId}?projection=DRAFT`,
  method: "GET",
  headers: authHeaders(accessToken),
});

/** Normalized OAuth2 token-exchange outcome. */
export interface TokenResult {
  readonly accessToken: string | null;
  readonly error: string | null;
}

/** Interprets a token-exchange response body (pure). */
export const interpretTokenResponse = (payload: unknown): TokenResult => {
  const record = asRecord(payload);
  const accessToken = record?.["access_token"];
  const errorDescription = record?.["error_description"];
  const error = record?.["error"];
  return {
    accessToken: typeof accessToken === "string" ? accessToken : null,
    error:
      typeof errorDescription === "string"
        ? errorDescription
        : typeof error === "string"
          ? error
          : null,
  };
};

const itemErrorDetails = (value: unknown): string[] => {
  const entries = Array.isArray(value) ? value : [];
  const details: string[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    const detail = record?.["error_detail"];
    const code = record?.["error_code"];
    if (typeof detail === "string") {
      details.push(detail);
    } else if (typeof code === "string") {
      details.push(code);
    }
  }
  return details;
};

/** Normalized item-upload outcome. */
export interface UploadResult {
  readonly uploadState: string | null;
  readonly success: boolean;
  readonly inProgress: boolean;
  readonly errors: readonly string[];
}

/** Interprets an item resource returned by upload/status (pure). */
export const interpretUploadResponse = (payload: unknown): UploadResult => {
  const record = asRecord(payload);
  const state = record?.["uploadState"];
  const uploadState = typeof state === "string" ? state : null;
  return {
    uploadState,
    success: uploadState === "SUCCESS",
    inProgress: uploadState === "IN_PROGRESS",
    errors: itemErrorDetails(record?.["itemError"]),
  };
};

/** Normalized publish outcome. */
export interface PublishResult {
  readonly statuses: readonly string[];
  readonly ok: boolean;
  readonly pendingReview: boolean;
  readonly errors: readonly string[];
}

/** Interprets a publish response body (pure). */
export const interpretPublishResponse = (payload: unknown): PublishResult => {
  const record = asRecord(payload);
  const statuses = asStringArray(record?.["status"]);
  const details = asStringArray(record?.["statusDetail"]);
  const ok = statuses.some((status) => PUBLISH_OK_STATUSES.has(status));
  return {
    statuses,
    ok,
    pendingReview: statuses.includes("ITEM_PENDING_REVIEW"),
    errors: ok ? [] : details.length > 0 ? details : statuses,
  };
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const sendRequest = async (request: HttpRequest, body?: BodyInit): Promise<Response> => {
  const init: RequestInit = { method: request.method, headers: { ...request.headers } };
  if (body !== undefined) {
    init.body = body;
  } else if (request.body !== undefined) {
    init.body = request.body;
  }
  return fetch(request.url, init);
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text === "") {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
};

const exchangeToken = async (config: PublishConfig): Promise<string> => {
  const request = buildTokenExchangeRequest(config);
  const response = await sendRequest(request);
  const result = interpretTokenResponse(await readJson(response));
  if (result.accessToken === null) {
    throw new Error(
      `OAuth token exchange failed (HTTP ${response.status}): ${result.error ?? "no access_token"}`,
    );
  }
  return result.accessToken;
};

const uploadPackage = async (
  config: PublishConfig,
  accessToken: string,
  zipBytes: ArrayBuffer,
): Promise<void> => {
  const request = buildUploadRequest(config, accessToken);
  const response = await sendRequest(request, zipBytes);
  let result = interpretUploadResponse(await readJson(response));

  for (let attempt = 0; attempt < 6 && result.inProgress; attempt += 1) {
    await delay(5000);
    const poll = await sendRequest(buildStatusRequest(config, accessToken));
    result = interpretUploadResponse(await readJson(poll));
  }

  if (!result.success) {
    const detail =
      result.errors.length > 0 ? result.errors.join("; ") : (result.uploadState ?? "unknown");
    throw new Error(`Chrome Web Store upload failed: ${detail}`);
  }
};

const publishItem = async (config: PublishConfig, accessToken: string): Promise<PublishResult> => {
  const request = buildPublishRequest(config, accessToken);
  const response = await sendRequest(request);
  const result = interpretPublishResponse(await readJson(response));
  if (!result.ok) {
    const detail = result.errors.length > 0 ? result.errors.join("; ") : `HTTP ${response.status}`;
    throw new Error(`Chrome Web Store publish rejected: ${detail}`);
  }
  return result;
};

/**
 * Entrypoint. Reads config from the environment, skips cleanly (exit 0) when the
 * store is not yet configured, and otherwise performs the real token exchange,
 * upload, and publish — failing closed on any API rejection. Returns the process
 * exit code.
 */
export const main = async (
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> => {
  const resolution = resolveConfig(env);
  if (!resolution.configured) {
    console.log(
      `Chrome Web Store publish skipped — not configured (no account/secrets yet). Missing: ${resolution.missing.join(", ")}`,
    );
    return 0;
  }

  const { config } = resolution;
  const zipBytes = await Bun.file(config.zipPath).arrayBuffer();
  const plan = `item ${config.extensionId}, target ${config.publishTarget}${config.deployPercentage === "" ? "" : `, rollout ${config.deployPercentage}%`}, ${zipBytes.byteLength} bytes from ${config.zipPath}`;

  if (config.dryRun) {
    console.log(
      `Chrome Web Store dry run — validated package and request plan, not publishing: ${plan}`,
    );
    return 0;
  }

  console.log(`Chrome Web Store publish starting: ${plan}`);
  const accessToken = await exchangeToken(config);
  await uploadPackage(config, accessToken, zipBytes);
  const result = await publishItem(config, accessToken);
  console.log(
    `Chrome Web Store publish accepted (${result.statuses.join(", ")}) — submitted for review; store review latency is out of pipeline control.`,
  );
  return 0;
};

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
