/**
 * Decoder checks for the sandbox render page: a self-contained data:text/html
 * animation decodes to its HTML, while wrong media types, remote URIs, malformed
 * base64, empty, and oversized payloads all fail closed to null.
 */
import { describe, expect, test } from "bun:test";
import { decodeHtmlDataUri } from "../../src/sandbox/render-payload";

describe("decodeHtmlDataUri", () => {
  const html = "<!doctype html><html><body><canvas></canvas><script>1;</script></body></html>";

  test("decodes base64 and utf8 data:text/html to the HTML string", () => {
    expect(decodeHtmlDataUri(`data:text/html;base64,${btoa(html)}`)).toBe(html);
    expect(decodeHtmlDataUri(`data:text/html,${encodeURIComponent(html)}`)).toBe(html);
    expect(decodeHtmlDataUri(`data:text/html;charset=utf-8;base64,${btoa(html)}`)).toBe(html);
  });

  test("fails closed for wrong type, remote, malformed, empty, and oversized URIs", () => {
    expect(decodeHtmlDataUri(`data:image/svg+xml;base64,${btoa("<svg/>")}`)).toBeNull();
    expect(decodeHtmlDataUri("https://example.com/a.html")).toBeNull();
    expect(decodeHtmlDataUri("data:text/html;base64,")).toBeNull();
    expect(decodeHtmlDataUri("data:text/html;base64,not valid!!")).toBeNull();
    expect(decodeHtmlDataUri("data:text/html")).toBeNull();
    expect(decodeHtmlDataUri(`data:text/html;base64,${"A".repeat(33_000)}`)).toBeNull();
  });
});
