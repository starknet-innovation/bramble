/**
 * Guards the deployed security headers.
 *
 * `public/_headers` is a plain text file with no compiler or linter watching it,
 * and Cloudflare silently serves whatever it parses — a deleted line or a typo
 * in a directive name removes protection without failing anything. These
 * assertions are the only thing standing between that and a silent regression.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const headers = await readFile(new URL("../../public/_headers", import.meta.url), "utf8");

// Everything the site serves is same-origin, so one target covers it. A second
// target would mean some paths are unprotected, which is worth failing on.
const RULE_TARGETS = headers.split("\n").filter((line) => line.startsWith("/"));

// Comments explain which headers are deliberately set elsewhere, so they name
// headers this file must not declare. Assertions read the directives only.
const DIRECTIVE_LINES = headers
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

const headerValue = (name: string): string =>
  headers
    .split("\n")
    .find((line) => line.trim().toLowerCase().startsWith(`${name.toLowerCase()}:`))
    ?.split(":")
    .slice(1)
    .join(":")
    .trim() ?? "";

describe("deployed security headers", () => {
  test("applies to every path from a single rule", () => {
    expect(RULE_TARGETS).toEqual(["/*"]);
  });

  test("denies framing in the enforcing policy, not only report-only", () => {
    // frame-ancestors is ignored in a report-only policy, so clickjacking
    // protection only exists if it appears in the enforcing header.
    expect(headerValue("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headerValue("Content-Security-Policy")).toContain("base-uri 'none'");
    expect(headerValue("X-Frame-Options")).toBe("DENY");
  });

  test("keeps the full policy report-only until it is promoted deliberately", () => {
    const reportOnly = headerValue("Content-Security-Policy-Report-Only");
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
    ]) {
      expect(reportOnly).toContain(directive);
    }
    // Promoting the policy means moving these into the enforcing header. Until
    // then the enforcing header must not carry a fetch directive, because one
    // wrong source blanks a single-page app rather than degrading it.
    expect(headerValue("Content-Security-Policy")).not.toContain("script-src");
    expect(headerValue("Content-Security-Policy")).not.toContain("default-src");
  });

  test("denies the browser features the site never uses", () => {
    const policy = headerValue("Permissions-Policy");
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb", "serial"]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  test("sets a referrer policy and isolates the browsing context", () => {
    expect(headerValue("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headerValue("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  test("leaves HSTS and nosniff to the Cloudflare edge", () => {
    // Both are configured under SSL/TLS -> Edge Certificates. Declaring them
    // here as well would emit each header from two sources of truth.
    expect(DIRECTIVE_LINES).not.toContain("Strict-Transport-Security");
    expect(DIRECTIVE_LINES).not.toContain("X-Content-Type-Options");
    // ...and the comments must keep saying why, so the next reader does not
    // "fix" the apparent omission by adding them back.
    expect(headers).toContain("configured at the");
  });
});
