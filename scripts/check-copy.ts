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
 * It reads string and template literals only, after blanking comments, so a
 * note to a future maintainer is never mistaken for something a user reads.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { COPY_EXEMPT_PATHS, COPY_PATTERNS, COPY_SCAN_ROOTS } from "./copy-policy";

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

/**
 * Replaces every comment with spaces, preserving length so byte offsets still
 * map to their original line. Quote characters inside a comment would
 * otherwise open a string that swallows the rest of the file.
 */
const blankComments = (text: string): string => {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const block = /^\/\*[\s\S]*?\*\//.exec(rest);
    const line = /^\/\/[^\n]*/.exec(rest);
    const quoted = /^(["'`])(?:\\.|(?!\1)[\s\S])*\1/.exec(rest);
    if (quoted) {
      output += quoted[0];
      index += quoted[0].length;
    } else if (block) {
      output += block[0].replace(/[^\n]/g, " ");
      index += block[0].length;
    } else if (line) {
      output += " ".repeat(line[0].length);
      index += line[0].length;
    } else {
      output += text[index] ?? "";
      index += 1;
    }
  }
  return output;
};

// Selectors, attribute values, ids, urls, single tokens, and anything long
// enough to be data rather than a sentence (the BIP39 list) are not prose. The
// test is deliberately loose: a false positive costs a reviewer one glance,
// while skipping real copy costs the rule its point.
const isProse = (value: string): boolean =>
  value.length <= 400 &&
  value.trim().split(/\s+/).length >= 3 &&
  /[a-z]{3}/.test(value) &&
  !/^[\w.-]+$/.test(value.trim()) &&
  !/^(?:https?:|data:|0x|--|\.|#|[A-Za-z-]+\s*[:{;])/.test(value.trim()) &&
  !/[<>{}]/.test(value);

/** Every quoted run and every literal chunk between `${}` holes. */
const copyStrings = (text: string): readonly { readonly index: number; readonly value: string }[] =>
  [...text.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g)].flatMap((match) => {
    const body = match[2] ?? "";
    const start = (match.index ?? 0) + 1;
    if (match[1] !== "`") return [{ index: start, value: body }];
    const chunks: { readonly index: number; readonly value: string }[] = [];
    let offset = 0;
    for (const chunk of body.split(/\$\{[^}]*\}/g)) {
      chunks.push({ index: start + offset, value: chunk });
      offset += chunk.length;
    }
    return chunks;
  });

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const findings: Finding[] = [];
for (const root of COPY_SCAN_ROOTS) {
  for (const file of await sourceFiles(root)) {
    if (COPY_EXEMPT_PATHS.some((exempt) => file.startsWith(exempt))) continue;
    const source = blankComments(await readFile(file, "utf8"));
    for (const { index, value } of copyStrings(source)) {
      if (!isProse(value)) continue;
      for (const { note, pattern, rule } of COPY_PATTERNS) {
        if (pattern.test(value)) {
          findings.push({ file, line: lineOf(source, index), note, rule, text: value.trim() });
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
