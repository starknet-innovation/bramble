/**
 * Unit tests for the pure Chrome Web Store publish helpers: config resolution,
 * request construction, and response interpretation. No network is touched.
 */
import { describe, expect, test } from "bun:test";
import {
  buildPublishRequest,
  buildStatusRequest,
  buildTokenExchangeRequest,
  buildUploadRequest,
  CWS_API_BASE,
  CWS_API_VERSION,
  GOOGLE_TOKEN_ENDPOINT,
  interpretPublishResponse,
  interpretTokenResponse,
  interpretUploadResponse,
  type PublishConfig,
  resolveConfig,
} from "../../scripts/publish-chrome-web-store";

const FULL_ENV = {
  CWS_CLIENT_ID: "client-id",
  CWS_CLIENT_SECRET: "client-secret",
  CWS_REFRESH_TOKEN: "refresh-token",
  CWS_EXTENSION_ID: "abcextensionid",
  CWS_ZIP_PATH: "artifacts/mc-wallet-0.3.0.zip",
} as const;

const config = (overrides: Partial<PublishConfig> = {}): PublishConfig => ({
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  extensionId: "abcextensionid",
  zipPath: "artifacts/mc-wallet-0.3.0.zip",
  publishTarget: "trustedTesters",
  deployPercentage: "",
  dryRun: false,
  ...overrides,
});

describe("resolveConfig", () => {
  test("skips cleanly and names every missing secret when unconfigured", () => {
    const result = resolveConfig({});
    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.missing).toEqual([
        "CWS_CLIENT_ID",
        "CWS_CLIENT_SECRET",
        "CWS_REFRESH_TOKEN",
        "CWS_EXTENSION_ID",
      ]);
    }
  });

  test("treats an empty-string secret as missing", () => {
    const result = resolveConfig({ ...FULL_ENV, CWS_REFRESH_TOKEN: "" });
    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.missing).toEqual(["CWS_REFRESH_TOKEN"]);
    }
  });

  test("defaults publish target to trustedTesters and no rollout", () => {
    const result = resolveConfig(FULL_ENV);
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.publishTarget).toBe("trustedTesters");
      expect(result.config.deployPercentage).toBe("");
      expect(result.config.dryRun).toBe(false);
    }
  });

  test("passes through an explicit default target, rollout, and dry-run", () => {
    const result = resolveConfig({
      ...FULL_ENV,
      CWS_PUBLISH_TARGET: "default",
      CWS_DEPLOY_PERCENTAGE: "25",
      CWS_DRY_RUN: "true",
    });
    expect(result.configured).toBe(true);
    if (result.configured) {
      expect(result.config.publishTarget).toBe("default");
      expect(result.config.deployPercentage).toBe("25");
      expect(result.config.dryRun).toBe(true);
    }
  });

  test("rejects an invalid publish target", () => {
    expect(() => resolveConfig({ ...FULL_ENV, CWS_PUBLISH_TARGET: "everyone" })).toThrow(
      /CWS_PUBLISH_TARGET/,
    );
  });

  test("rejects an out-of-range deploy percentage", () => {
    expect(() => resolveConfig({ ...FULL_ENV, CWS_DEPLOY_PERCENTAGE: "150" })).toThrow(
      /CWS_DEPLOY_PERCENTAGE/,
    );
  });

  test("requires a zip path", () => {
    expect(() => resolveConfig({ ...FULL_ENV, CWS_ZIP_PATH: "" })).toThrow(/CWS_ZIP_PATH/);
  });
});

describe("buildTokenExchangeRequest", () => {
  test("posts the refresh-token grant to Google's token endpoint", () => {
    const request = buildTokenExchangeRequest(config());
    expect(request.url).toBe(GOOGLE_TOKEN_ENDPOINT);
    expect(request.method).toBe("POST");
    expect(request.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(request.body ?? "");
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("client_id")).toBe("client-id");
    expect(params.get("client_secret")).toBe("client-secret");
    expect(params.get("refresh_token")).toBe("refresh-token");
  });
});

describe("buildUploadRequest", () => {
  test("PUTs to the item upload path with bearer and api-version headers", () => {
    const request = buildUploadRequest(config(), "access-token");
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(`${CWS_API_BASE}/upload/chromewebstore/v1.1/items/abcextensionid`);
    expect(request.headers["authorization"]).toBe("Bearer access-token");
    expect(request.headers["x-goog-api-version"]).toBe(CWS_API_VERSION);
    expect(request.body).toBeUndefined();
  });
});

describe("buildPublishRequest", () => {
  test("POSTs with an explicit publishTarget and no rollout by default", () => {
    const request = buildPublishRequest(config(), "access-token");
    expect(request.method).toBe("POST");
    const url = new URL(request.url);
    expect(url.pathname).toBe("/chromewebstore/v1.1/items/abcextensionid/publish");
    expect(url.searchParams.get("publishTarget")).toBe("trustedTesters");
    expect(url.searchParams.has("deployPercentage")).toBe(false);
    expect(request.headers["authorization"]).toBe("Bearer access-token");
  });

  test("appends deployPercentage only when a staged rollout is configured", () => {
    const request = buildPublishRequest(
      config({ publishTarget: "default", deployPercentage: "10" }),
      "access-token",
    );
    const url = new URL(request.url);
    expect(url.searchParams.get("publishTarget")).toBe("default");
    expect(url.searchParams.get("deployPercentage")).toBe("10");
  });
});

describe("buildStatusRequest", () => {
  test("GETs the DRAFT projection for the item", () => {
    const request = buildStatusRequest(config(), "access-token");
    expect(request.method).toBe("GET");
    expect(request.url).toBe(
      `${CWS_API_BASE}/chromewebstore/v1.1/items/abcextensionid?projection=DRAFT`,
    );
  });
});

describe("interpretTokenResponse", () => {
  test("extracts the access token on success", () => {
    expect(interpretTokenResponse({ access_token: "abc", expires_in: 3600 })).toEqual({
      accessToken: "abc",
      error: null,
    });
  });

  test("surfaces the error description on failure", () => {
    expect(
      interpretTokenResponse({ error: "invalid_grant", error_description: "Token revoked" }),
    ).toEqual({ accessToken: null, error: "Token revoked" });
  });
});

describe("interpretUploadResponse", () => {
  test("marks SUCCESS as a completed upload", () => {
    const result = interpretUploadResponse({ uploadState: "SUCCESS" });
    expect(result.success).toBe(true);
    expect(result.inProgress).toBe(false);
  });

  test("flags IN_PROGRESS for polling", () => {
    const result = interpretUploadResponse({ uploadState: "IN_PROGRESS" });
    expect(result.success).toBe(false);
    expect(result.inProgress).toBe(true);
  });

  test("collects itemError details on FAILURE", () => {
    const result = interpretUploadResponse({
      uploadState: "FAILURE",
      itemError: [{ error_code: "ITEM_INVALID", error_detail: "Manifest version too low" }],
    });
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(["Manifest version too low"]);
  });
});

describe("interpretPublishResponse", () => {
  test("treats OK as accepted", () => {
    const result = interpretPublishResponse({ status: ["OK"] });
    expect(result.ok).toBe(true);
    expect(result.pendingReview).toBe(false);
  });

  test("treats ITEM_PENDING_REVIEW as accepted and pending", () => {
    const result = interpretPublishResponse({ status: ["ITEM_PENDING_REVIEW"] });
    expect(result.ok).toBe(true);
    expect(result.pendingReview).toBe(true);
  });

  test("treats an authorization error as rejected and surfaces detail", () => {
    const result = interpretPublishResponse({
      status: ["NOT_AUTHORIZED"],
      statusDetail: ["Account not authorized to publish this item"],
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["Account not authorized to publish this item"]);
  });
});
