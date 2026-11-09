/**
 * Warns about wording habits the copy review kept deleting: unasked
 * reassurance, narration of the wallet's own internals, filler, and
 * acknowledgement prompts. See `docs/COPY_STYLE.md` for the rules and the
 * shipped strings each pattern was derived from.
 *
 * This gate never fails a build. Wording is a judgement call and a regex
 * cannot make it: a hit is a question for the author, not a verdict, and a
 * deliberate exception is answered by leaving the line alone. It is here so
 * that the habits come back as a visible warning rather than silently, which
 * matters most for copy written by agents rather than read by reviewers.
 *
 * It reads string and template literals only, from the parsed source, so a
 * note to a future maintainer is never mistaken for something a user reads.
 * The scan roots resolve from this script's own location, so it reads the same
 * files whatever directory it is run from.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  COPY_EXEMPT_PATHS,
  COPY_EXEMPT_STRINGS,
  COPY_PATTERNS,
  COPY_SCAN_ROOTS,
  copyLiterals,
  isProse,
  textRuns,
} from "./copy-policy";

const REPOSITORY = join(import.meta.dir, "..");

/** One flagged string, with enough context to judge it without opening the file. */
type Finding = {
  readonly file: string;
  readonly line: number;
  readonly note: string;
  readonly rule: string;
  readonly text: string;
};

const SKIP_DIRECTORIES = new Set(["node_modules", "tests"]);

const sourceFiles = async (root: string): Promise<readonly string[]> => {
  const found: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) await walk(path);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        found.push(path);
      }
    }
  };
  await walk(root);
  return found;
};

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const findings: Finding[] = [];
for (const root of COPY_SCAN_ROOTS) {
  for (const path of await sourceFiles(join(REPOSITORY, root))) {
    const file = relative(REPOSITORY, path).split(sep).join("/");
    if (COPY_EXEMPT_PATHS.some((exempt) => file.startsWith(exempt))) continue;
    const source = await readFile(path, "utf8");
    for (const literal of copyLiterals(file, source)) {
      for (const { index, value } of textRuns(literal.value, literal.index)) {
        if (!isProse(value)) continue;
        if (COPY_EXEMPT_STRINGS.some((exempt) => exempt.text === value.trim())) continue;
        for (const { note, pattern, rule } of COPY_PATTERNS) {
          if (pattern.test(value)) {
            findings.push({ file, line: lineOf(source, index), note, rule, text: value.trim() });
          }
        }
      }
    }
  }
}

if (findings.length > 0) {
  const byRule = new Map<string, Finding[]>();
  for (const finding of findings) {
    byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
  }
  console.warn(
    `\ncheck:copy — ${findings.length} wording warning${findings.length === 1 ? "" : "s"}. Not a build failure; see docs/COPY_STYLE.md.\n`,
  );
  for (const [rule, hits] of byRule) {
    console.warn(`  ${rule}`);
    console.warn(`    ${hits[0]?.note ?? ""}`);
    for (const hit of hits) {
      const excerpt = hit.text.length > 96 ? `${hit.text.slice(0, 96)}…` : hit.text;
      console.warn(`    ${hit.file}:${hit.line}  ${excerpt}`);
    }
    console.warn("");
  }
}
