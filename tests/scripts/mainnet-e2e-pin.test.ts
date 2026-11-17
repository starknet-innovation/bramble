/**
 * The Mainnet E2E workflow's exact bytes are pinned: any edit, however a YAML
 * parser decodes it, fails until the reviewed hash is updated. The structural
 * layer still names the parser differentials it can see on its own.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { mainnetE2eDocumentFailures } from "../../scripts/mainnet-e2e-workflow-document";
import {
  MAINNET_E2E_WORKFLOW_SHA256,
  mainnetE2ePinFailures,
  PIN_FAILURE,
} from "../../scripts/mainnet-e2e-workflow-pin";
import { mainnetE2eWorkflowFailures } from "../../scripts/mainnet-e2e-workflow-policy";
import { readWorkflowSources } from "../../scripts/workflow-inventory";
import { yamlDifferentialFailures } from "../../scripts/workflow-yaml-scalars";
import { PIN_EDITS } from "./mainnet-e2e-character-mutations";

const workflow = async (): Promise<string> =>
  (await readWorkflowSources())["mainnet-e2e.yml"] ?? "";

describe("mainnet E2E workflow exact-bytes pin", () => {
  test("the reviewed workflow matches the pinned SHA-256 of its bytes", async () => {
    const source = await workflow();
    const bytes = await Bun.file(".github/workflows/mainnet-e2e.yml").bytes();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(MAINNET_E2E_WORKFLOW_SHA256);
    expect(mainnetE2ePinFailures(source)).toEqual([]);
  });

  test("any edit fails the pin with a message that says how to update it", async () => {
    const source = await workflow();
    for (const { label, edit, structural } of PIN_EDITS) {
      const changed = edit(source);
      const actual = createHash("sha256").update(changed, "utf8").digest("hex");
      expect(mainnetE2eWorkflowFailures(changed)).toContain(`${PIN_FAILURE} (now ${actual})`);
      const document = mainnetE2eDocumentFailures(changed);
      if (structural === "" ? document.length > 0 : !document.includes(structural)) {
        throw new Error(`structural layer on ${label}: ${document.join("\n")}`);
      }
    }
  });

  test("a BOM, CRLF or other spelling of the same document fails only the pin", async () => {
    const source = await workflow();
    for (const changed of [`﻿${source}`, source.replaceAll("\n", "\r\n")]) {
      expect(mainnetE2eDocumentFailures(changed)).toEqual([]);
      expect(mainnetE2eWorkflowFailures(changed)).toHaveLength(1);
    }
  });

  test("multi-line text only as a literal block headed | or |-", () => {
    const check = (text: string): string[] =>
      yamlDifferentialFailures(text, parseDocument(text, { version: "1.2", schema: "core" }), "w");
    expect(check("a: |\n  x\nb: |-\n  y\nc: 'one line'\n")).toEqual([]);
    expect(check("a: |+\n  x\n")).toEqual(["w must not use the block header |+"]);
    expect(check("a: |2\n   x\n")).toEqual(["w must not use the block header |2"]);
    expect(check("a: >\n  x\n")).toEqual(["w must not use folded (>) block scalars"]);
    for (const text of ["a: 'x\n  y'\n", 'a: "x\n  y"\n', "a: x\n  y\n"]) {
      expect(check(text)).toEqual(["w must keep every plain or quoted scalar on one line"]);
    }
  });
});
