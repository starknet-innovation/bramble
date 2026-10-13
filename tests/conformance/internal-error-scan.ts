/**
 * Every error message the wallet's own code throws, read from the production
 * sources. Shared by the conformance checks that decide what a reader may see
 * (mc-wallet issue 652).
 *
 * Matched on shape: `new <Something>Error("…")` / `new RefusedBeforeWrite("…")`
 * with a literal or a template with no substitutions, plus any literal that
 * opens with a guard prefix passed through a helper ("Unlock session …").
 * Templates with substitutions are left to the family patterns, which the
 * classifier applies to every string at run time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

/** Where the side panel's error strings are minted. */
export const PANEL_ERROR_SOURCES = [
  "apps/extension/src",
  "packages/features",
  "packages/foundation",
  "packages/platform",
  "packages/presentation/wallet-ui/src/sidepanel",
];

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const path = join(dir, entry);
    if (statSync(join(root, path)).isDirectory()) {
      if (entry !== "tests" && entry !== "node_modules") out.push(...sourceFiles(path));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
};

const THROWN = /new\s+([A-Z]\w*)\(\s*(["`])((?:(?!\2)[^\\]|\\.)*)\2/g;
const GUARD_LITERAL = /"((?:Unlock session|Krusty KMS) [^"]+)"/g;

/** A thrown message and the file it is minted in. */
export interface ThrownMessage {
  readonly raw: string;
  readonly file: string;
}

/** Every distinct thrown message under `dirs`, with one file that mints it. */
export const thrownMessages = (dirs: readonly string[]): readonly ThrownMessage[] => {
  const found = new Map<string, string>();
  for (const dir of dirs) {
    for (const file of sourceFiles(dir)) {
      const src = readFileSync(join(root, file), "utf8");
      for (const match of src.matchAll(THROWN)) {
        const [, callee, , raw] = match;
        if (!callee || !raw || !/Error|Refused/.test(callee) || raw.includes("${")) continue;
        if (!found.has(raw)) found.set(raw, file);
      }
      for (const match of src.matchAll(GUARD_LITERAL)) {
        const raw = match[1];
        if (raw && !found.has(raw)) found.set(raw, file);
      }
    }
  }
  return [...found].map(([raw, file]) => ({ file, raw }));
};
