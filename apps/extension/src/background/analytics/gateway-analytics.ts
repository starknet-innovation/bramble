/**
 * Privacy-preserving metadata for requests to the wallet-owned backend. The
 * wrapper is installed only by the extension background entrypoint so the
 * vendored privacy SDK and starknet.js share the same exact-origin policy.
 */

import { STRK20_GATEWAY_BASE } from "@mc-wallet/privacy/config";
import type { Strk20Service } from "@mc-wallet/privacy/service";
import type { KeyValueStore } from "@mc-wallet/store/kv";

/** Persistent, non-secret installation metadata kept outside the vault. */
export const ANALYTICS_INSTALLATION_ID_KEY = "mc-wallet:analytics-installation-id";

/** The only origin allowed to receive product-analytics metadata. */
export const ANALYTICS_GATEWAY_ORIGIN = new URL(STRK20_GATEWAY_BASE).origin;

const INSTALLATION_HEADER = "X-MC-Installation-ID";
const VERSION_HEADER = "X-MC-App-Version";
const PLATFORM_HEADER = "X-MC-Platform";
const RELEASE_CHANNEL_HEADER = "X-MC-Release-Channel";
const FLOW_HEADER = "X-MC-Flow-ID";
const ANALYTICS_HEADERS = [
  INSTALLATION_HEADER,
  VERSION_HEADER,
  PLATFORM_HEADER,
  RELEASE_CHANNEL_HEADER,
  FLOW_HEADER,
] as const;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const APP_VERSION = /^[A-Za-z0-9.+-]{1,32}$/;

type GatewayHttp = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Low-cardinality client metadata accepted by the backend contract. */
export type GatewayAnalyticsMetadata = {
  readonly appVersion: string;
  readonly platform: "brave" | "chrome" | "edge" | "firefox" | "other";
  readonly releaseChannel: "beta" | "development" | "production";
};

/** Product-analytics fetch boundary plus a STRK20 workflow scope. */
export type GatewayAnalytics = {
  readonly fetch: GatewayHttp;
  readonly withFlow: <T>(run: () => Promise<T>) => Promise<T>;
};

type GatewayAnalyticsOptions = {
  readonly enabled: () => boolean | Promise<boolean>;
  readonly http: GatewayHttp;
  readonly metadata: GatewayAnalyticsMetadata;
  readonly randomUuid: () => string;
  readonly store: KeyValueStore;
};

const validUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_V4.test(value);

const requestUrl = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input instanceof URL ? input.href : input;

const isGatewayRequest = (input: RequestInfo | URL): boolean => {
  try {
    return new URL(requestUrl(input)).origin === ANALYTICS_GATEWAY_ORIGIN;
  } catch {
    return false;
  }
};

const isStrk20GatewayRequest = (input: RequestInfo | URL): boolean => {
  try {
    const url = new URL(requestUrl(input));
    return (
      url.origin === ANALYTICS_GATEWAY_ORIGIN &&
      (url.pathname === "/api/strk20" || url.pathname.startsWith("/api/strk20/"))
    );
  } catch {
    return false;
  }
};

const mergedHeaders = (input: RequestInfo | URL, init?: RequestInit): Headers => {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => {
    headers.set(name, value);
  });
  return headers;
};

const stripAnalyticsHeaders = (headers: Headers): boolean => {
  let changed = false;
  for (const name of ANALYTICS_HEADERS) {
    if (headers.has(name)) {
      headers.delete(name);
      changed = true;
    }
  }
  return changed;
};

const metadataIsValid = (metadata: GatewayAnalyticsMetadata): boolean =>
  APP_VERSION.test(metadata.appVersion);

/** Generates one canonical UUID at the reviewed analytics randomness boundary. */
export const randomAnalyticsUuid = (): string => crypto.randomUUID();

/**
 * Classifies the browser without retaining its user-agent string. Brave is an
 * explicit capability because its Chromium user agent otherwise looks like
 * Chrome.
 */
export const analyticsPlatform = (
  userAgent: string,
  braveAvailable = false,
): GatewayAnalyticsMetadata["platform"] => {
  if (braveAvailable) return "brave";
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/(?:Chrome|CriOS)\//.test(userAgent)) return "chrome";
  return "other";
};

/** Maps build provenance to the backend's bounded release-channel values. */
export const analyticsReleaseChannel = (
  buildBranch: string,
): GatewayAnalyticsMetadata["releaseChannel"] => {
  if (buildBranch === "") return "production";
  return /^beta(?:[/_-]|$)/i.test(buildBranch) ? "beta" : "development";
};

/**
 * Creates a fail-open-for-wallet-traffic analytics wrapper. Storage,
 * preference, or metadata failures omit every analytics header rather than
 * blocking the underlying request or emitting a partial set. Requests carrying
 * metadata reject redirects so identifiers cannot escape the gateway origin.
 */
export const createGatewayAnalytics = ({
  enabled,
  http,
  metadata,
  randomUuid,
  store,
}: GatewayAnalyticsOptions): GatewayAnalytics => {
  let installationId: Promise<string | null> | undefined;
  let activeFlowId: string | undefined;
  let flowQueue: Promise<void> = Promise.resolve();

  const isEnabled = async (): Promise<boolean> => {
    try {
      return (await enabled()) === true;
    } catch {
      return false;
    }
  };

  const readInstallationId = (): Promise<string | null> => {
    installationId ??= (async () => {
      try {
        const stored = await store.get(ANALYTICS_INSTALLATION_ID_KEY);
        if (validUuid(stored)) return stored;
        const generated = randomUuid();
        if (!validUuid(generated)) return null;
        await store.set(ANALYTICS_INSTALLATION_ID_KEY, generated);
        return generated;
      } catch {
        return null;
      }
    })();
    return installationId;
  };

  const addAnalyticsHeaders = async (input: RequestInfo | URL, headers: Headers): Promise<void> => {
    if (!(await isEnabled()) || !metadataIsValid(metadata)) {
      return;
    }
    const id = await readInstallationId();
    if (id === null) {
      return;
    }
    headers.set(INSTALLATION_HEADER, id);
    headers.set(VERSION_HEADER, metadata.appVersion);
    headers.set(PLATFORM_HEADER, metadata.platform);
    headers.set(RELEASE_CHANNEL_HEADER, metadata.releaseChannel);
    if (activeFlowId !== undefined && isStrk20GatewayRequest(input)) {
      headers.set(FLOW_HEADER, activeFlowId);
    }
  };

  const analyticsFetch: GatewayHttp = async (input, init) => {
    const headers = mergedHeaders(input, init);
    const stripped = stripAnalyticsHeaders(headers);
    if (!isGatewayRequest(input)) {
      return http(input, stripped ? { ...init, headers } : init);
    }
    await addAnalyticsHeaders(input, headers);
    return http(input, {
      ...init,
      headers,
      ...(headers.has(INSTALLATION_HEADER) ? { redirect: "error" as const } : {}),
    });
  };

  const withFlow = async <T>(run: () => Promise<T>): Promise<T> => {
    if (!(await isEnabled())) return run();
    let release = (): void => undefined;
    const previous = flowQueue;
    flowQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const generated = randomUuid();
    activeFlowId = validUuid(generated) ? generated : undefined;
    try {
      return await run();
    } finally {
      activeFlowId = undefined;
      release();
    }
  };

  return { fetch: analyticsFetch, withFlow };
};

/**
 * Serializes each STRK20 service operation inside one transient flow scope.
 * This is required because the pinned SDK owns its discovery/proving fetches;
 * exact-origin interception is the only shared injection boundary it exposes.
 */
export const withGatewayAnalyticsFlows = (
  service: Strk20Service,
  withFlow: GatewayAnalytics["withFlow"],
): Strk20Service => {
  const poolFee = service.poolFee;
  const prepareAccountActions = service.prepareAccountActions;
  const prepareRegistration = service.prepareRegistration;
  const register = service.register;
  const registrationStatus = service.registrationStatus;
  const subaccountCommitment = service.subaccountCommitment;
  return {
    ...service,
    prepare: (input) => withFlow(() => service.prepare(input)),
    privateBalances: (input) => withFlow(() => service.privateBalances(input)),
    quoteActions: (input) => withFlow(() => service.quoteActions(input)),
    submitActions: (input) => withFlow(() => service.submitActions(input)),
    submitPrepared: (input) => withFlow(() => service.submitPrepared(input)),
    ...(poolFee ? { poolFee: (input) => withFlow(() => poolFee(input)) } : {}),
    ...(prepareAccountActions
      ? { prepareAccountActions: (input) => withFlow(() => prepareAccountActions(input)) }
      : {}),
    ...(prepareRegistration
      ? { prepareRegistration: (input) => withFlow(() => prepareRegistration(input)) }
      : {}),
    ...(register ? { register: (input) => withFlow(() => register(input)) } : {}),
    ...(registrationStatus
      ? { registrationStatus: (input) => withFlow(() => registrationStatus(input)) }
      : {}),
    ...(subaccountCommitment
      ? { subaccountCommitment: (input) => withFlow(() => subaccountCommitment(input)) }
      : {}),
  };
};
