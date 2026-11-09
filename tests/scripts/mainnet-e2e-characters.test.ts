/**
 * The Mainnet E2E policy checks the raw workflow source against a character
 * allowlist before parsing, so nothing can be hidden behind a line break one
 * parser sees and another does not, nor behind an invisible character.
 */
import { describe, expect, test } from "bun:test";
import { parseDocument } from "yaml";
import { mainnetE2eDocumentFailures } from "../../scripts/mainnet-e2e-workflow-document";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { sourceCharacterFailures } from "../../scripts/workflow-source-characters";
import { yamlDifferentialFailures } from "../../scripts/workflow-yaml-scalars";
import { ANCHOR, CHARACTER_CONTROLS, CHARACTER_EDITS } from "./mainnet-e2e-character-mutations";

const PATH = ".github/workflows/mainnet-e2e.yml";

const workflow = async (): Promise<string> =>
  (await readWorkflowSources())["mainnet-e2e.yml"] ?? "";

const edited = (source: string, prefix: string, insert: string): string => {
  expect(source).toContain(ANCHOR);
  return `${prefix}${source.replace(ANCHOR, () => `${insert}${ANCHOR}`)}`;
};

describe("mainnet E2E workflow source characters", () => {
  test("refuses each character outside the allowlist, naming line and code point", async () => {
    const source = await workflow();
    for (const { label, prefix, insert, codePoint } of CHARACTER_EDITS) {
      const failures = mainnetE2eDocumentFailures(edited(source, prefix, insert));
      const named = failures.some(
        (failure) =>
          failure.startsWith(`${PATH} line `) && failure.endsWith(` must not contain ${codePoint}`),
      );
      if (!named) throw new Error(`accepted ${label}: ${failures.join("\n")}`);
    }
  });

  test("accepts CRLF, a leading BOM, an em dash and % in a comment", async () => {
    const source = await workflow();
    expect(mainnetE2eDocumentFailures(source.replaceAll("\n", "\r\n"))).toEqual([]);
    for (const { label, prefix, insert } of CHARACTER_CONTROLS) {
      const failures = mainnetE2eDocumentFailures(edited(source, prefix, insert));
      if (failures.length > 0) throw new Error(`rejected ${label}: ${failures.join("\n")}`);
    }
  });

  test("counts lines by LF and reads code points, not UTF-16 units", () => {
    expect(sourceCharacterFailures("a\nb\u0085\r\nc\u{1F600}\n﻿", "w")).toEqual([
      "w line 2 must not contain U+0085",
      "w line 3 must not contain U+1F600",
      "w line 4 must not contain U+FEFF",
      "w must end with a line feed",
    ]);
    expect(sourceCharacterFailures("﻿a\r\nb — c\n", "w")).toEqual([]);
    expect(sourceCharacterFailures("a\r", "w")).toEqual([
      "w line 1 must not contain U+000D",
      "w must end with a line feed",
    ]);
  });

  test("accepts integers only up to 15 digits", () => {
    const check = (text: string): string[] =>
      yamlDifferentialFailures(text, parseDocument(text, { version: "1.2", schema: "core" }), "w");
    expect(check("a: 999999999999999\n")).toEqual([]);
    expect(check("a: 1000000000000000\n")).toEqual([
      "w must write every number as a plain decimal integer",
    ]);
  });
});
