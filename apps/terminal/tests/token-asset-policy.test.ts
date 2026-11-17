/**
 * Acceptance rules for synced token artwork (Sherlock 142, 143). Logo URLs
 * from a token list must name a public https host, and an SVG is kept only
 * when every element and attribute is a drawing primitive, so nothing that
 * can run script reaches the same-origin asset pack.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fetchLogo,
  isSafeSvg,
  MAX_LOGO_REDIRECTS,
  MAX_SVG_LENGTH,
  safeLogoUrl,
} from "../scripts/token-asset-policy";

// jsdom gives import.meta.url a non-file scheme, so resolve from this file's
// directory, which vitest provides as __dirname.
const ASSETS = join(__dirname, "../public/token-assets/extended");
const svg = (inner: string, attributes = ""): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"${attributes}>${inner}</svg>`;

describe("logo URLs", () => {
  it("upgrades CoinGecko thumbnails and keeps public https hosts", () => {
    expect(safeLogoUrl("https://assets.coingecko.com/coins/images/12/small/a.png")?.href).toBe(
      "https://assets.coingecko.com/coins/images/12/large/a.png",
    );
    expect(safeLogoUrl("https://cdn.example.com/token.png")?.href).toBe(
      "https://cdn.example.com/token.png",
    );
  });

  it("refuses other schemes, credentials, ports, IP literals and local names", () => {
    for (const uri of [
      "http://cdn.example.com/token.png",
      "file:///etc/passwd",
      "data:image/png;base64,AAAA",
      "https://user:pass@cdn.example.com/a.png",
      "https://user@cdn.example.com/a.png",
      "https://cdn.example.com:8443/a.png",
      "https://169.254.169.254/latest/meta-data",
      "https://127.0.0.1/a.png",
      "https://[::1]/a.png",
      "https://localhost/a.png",
      "https://printer.local/a.png",
      "https://intranet/a.png",
      "not a url",
    ]) {
      expect(safeLogoUrl(uri)).toBeNull();
    }
  });
});

describe("logo redirects", () => {
  const redirect = (location: string): Response =>
    new Response(null, { headers: { location }, status: 302 });
  const start = new URL("https://cdn.example.com/a.png");

  it("follows a redirect to another public https URL, re-checking it", async () => {
    const seen: string[] = [];
    const result = await fetchLogo(
      async (url, init) => {
        seen.push(`${url.href} ${init.redirect}`);
        return seen.length === 1 ? redirect("/b.png") : new Response("ok", { status: 200 });
      },
      start,
      {},
    );
    expect(result).toBeInstanceOf(Response);
    expect(seen).toEqual([
      "https://cdn.example.com/a.png manual",
      "https://cdn.example.com/b.png manual",
    ]);
  });

  it("refuses a redirect to a local or non-https URL", async () => {
    for (const location of ["http://cdn.example.com/a.png", "https://127.0.0.1/a.png", "file:///x"]) {
      expect(await fetchLogo(async () => redirect(location), start, {})).toBe(
        "redirect to a refused URL",
      );
    }
  });

  it("stops after the redirect limit", async () => {
    let fetches = 0;
    const result = await fetchLogo(
      async () => {
        fetches += 1;
        return redirect("/again.png");
      },
      start,
      {},
    );
    expect(result).toBe("too many redirects");
    expect(fetches).toBe(MAX_LOGO_REDIRECTS + 1);
  });
});

describe("SVG artwork", () => {
  it("accepts every SVG in the committed pack", () => {
    const files = readdirSync(ASSETS).filter((name) => name.endsWith(".svg"));
    expect(files.length).toBeGreaterThan(0);
    const refused = files.filter((name) => !isSafeSvg(readFileSync(join(ASSETS, name), "utf8")));
    expect(refused).toEqual([]);
  });

  it("accepts drawing primitives, fragment references and inline raster images", () => {
    expect(
      isSafeSvg(
        svg(
          '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
            '<path d="M0 0h32v32z" fill="url(#g)"/>' +
            '<image width="8" height="8" xlink:href="data:image/png;base64,iVBORw0KGgo="/>',
          ' xmlns:xlink="http://www.w3.org/1999/xlink"',
        ),
      ),
    ).toBe(true);
  });

  it("refuses event handlers, script in any namespace and foreign content", () => {
    for (const document of [
      svg('<circle r="4" onload="alert(1)"/>'),
      svg('<circle r="4" ONMOUSEOVER="alert(1)"/>'),
      svg("<script>alert(1)</script>"),
      svg("<svg:script>alert(1)</svg:script>"),
      svg("<foreignObject><div/></foreignObject>"),
      svg('<animate attributeName="href" to="javascript:alert(1)"/>'),
      svg('<set attributeName="onclick" to="alert(1)"/>'),
    ]) {
      expect(isSafeSvg(document)).toBe(false);
    }
  });

  it("refuses external references, escapes, entities and declarations", () => {
    for (const document of [
      svg('<use href="https://evil.example/a.svg#x"/>'),
      svg('<use xlink:href="javascript:alert(1)"/>'),
      svg('<image href="data:image/svg+xml;base64,PHN2Zz4="/>'),
      svg('<rect width="1" height="1" fill="url(https://evil.example/x)"/>'),
      svg('<rect width="1" height="1" style="background:url(//evil.example)"/>'),
      svg('<rect width="1" height="1" style="behavior:expression(alert(1))"/>'),
      svg('<rect width="1" height="1" fill="&#x6a;avascript:"/>'),
      svg("<title>&lt;b&gt;</title>"),
      `<!DOCTYPE svg [<!ENTITY x "y">]>${svg("<title>&x;</title>")}`,
      svg("<![CDATA[<script>alert(1)</script>]]>"),
      svg("<?xml-stylesheet href='https://evil.example/s.css'?>"),
      svg('<rect width="1" height="1" class="x"/>'),
      svg("<rect width=1 height=1/>"),
      svg('<rect width="1"/>', ' xmlns:x="http://evil.example/ns"'),
      `<html>${svg("")}</html>`,
      // An unclosed tag the tag pattern never reads.
      svg('<rect width="1"'),
    ]) {
      expect(isSafeSvg(document)).toBe(false);
    }
  });

  it("refuses an oversized document", () => {
    const padding = '<path d="M0 0"/>'.repeat(Math.ceil(MAX_SVG_LENGTH / 16) + 1);
    expect(isSafeSvg(svg(padding))).toBe(false);
  });
});
