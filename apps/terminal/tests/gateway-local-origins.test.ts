/**
 * Loopback origins are a `vercel dev` convenience (Sherlock 200): a deployed
 * gateway never grants CORS to them, whether from the built-in fallback or a
 * TERMINAL_ALLOWED_ORIGINS value that still lists them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResponse } from "../api/_lib/http";
import { authorizeOrigin } from "../api/_lib/security";

afterEach(() => {
  vi.unstubAllEnvs();
});

const decide = (origin: string): { allowed: boolean; status?: number } => {
  let status: number | undefined;
  const response = {
    end: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    status: vi.fn((code: number) => {
      status = code;
      return response;
    }),
  };
  const allowed = authorizeOrigin(
    { headers: { origin }, method: "POST" } as unknown as ApiRequest,
    response as unknown as ApiResponse,
    "terminal",
  );
  return status === undefined ? { allowed } : { allowed, status };
};

describe("terminal gateway loopback origins", () => {
  it("refuses loopback origins from the fallback on a production deployment", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("TERMINAL_ALLOWED_ORIGINS", "");
    expect(decide("http://localhost:3000")).toEqual({ allowed: false, status: 403 });
    expect(decide("http://127.0.0.1:5273")).toEqual({ allowed: false, status: 403 });
    expect(decide("https://mc-wallet-terminal.vercel.app")).toEqual({ allowed: true });
  });

  it("refuses loopback origins on a host that does not set VERCEL_ENV", () => {
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("TERMINAL_ALLOWED_ORIGINS", "");
    expect(decide("http://localhost:3000")).toEqual({ allowed: false, status: 403 });
  });

  it("drops a loopback entry from a deployed allowlist but keeps the rest of it", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv(
      "TERMINAL_ALLOWED_ORIGINS",
      "https://mc-wallet-terminal.vercel.app,http://localhost:3000",
    );
    expect(decide("http://localhost:3000")).toEqual({ allowed: false, status: 403 });
    expect(decide("https://mc-wallet-terminal.vercel.app")).toEqual({ allowed: true });
  });

  it("trusts nothing, not the production origin, when a deployed list names only loopback", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("TERMINAL_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:5273");
    expect(decide("http://localhost:3000")).toEqual({ allowed: false, status: 403 });
    expect(decide("https://mc-wallet-terminal.vercel.app")).toEqual({
      allowed: false,
      status: 403,
    });
  });

  it("accepts loopback origins under vercel dev", () => {
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("TERMINAL_ALLOWED_ORIGINS", "");
    expect(decide("http://localhost:5273")).toEqual({ allowed: true });
    vi.stubEnv("TERMINAL_ALLOWED_ORIGINS", "http://localhost:3000");
    expect(decide("http://localhost:3000")).toEqual({ allowed: true });
  });
});
