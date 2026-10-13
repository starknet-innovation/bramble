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

// `new <Something>Error(` / `new RefusedBeforeWrite(` with a literal or template.
const THROWN = /new\s+([A-Z]\w*)\(\s*(["`])((?:(?!\2)[^\\]|\\.)*)\2/g;
// `new <Something>Error(CONSTANT)` and `{ error: CONSTANT }`.
const THROWN_CONSTANT = /new\s+([A-Z]\w*)\(\s*([A-Z][A-Z0-9_]+)\s*[,)]/g;
// `{ error: "…" }` / `{ error: `…` }` replies, including multi-line ones.
const REPLY = /\berror:\s*(["`])((?:(?!\1)[^\\]|\\.){3,400})\1/g;
const REPLY_CONSTANT = /\berror:\s*([A-Z][A-Z0-9_]+)\b/g;
// `invariant(condition, "…")`.
const INVARIANT = /\binvariant\(\s*[^,]+,\s*(["`])((?:(?!\2)[^\\]|\\.)*)\2/g;
// Literals that open with a guard prefix passed through a helper.
const GUARD_LITERAL = /"((?:Unlock session|Krusty KMS) [^"]+)"/g;
// `const NAME = "…"` / `` const NAME = `…` `` string constants.
const STRING_CONSTANT = /\bconst\s+([A-Z][A-Z0-9_]+)\s*=\s*(["`])((?:(?!\2)[^\\]|\\.)*)\2/g;

/** A thrown message and the file it is minted in. */
export interface ThrownMessage {
  readonly raw: string;
  readonly file: string;
}

const readSources = (dirs: readonly string[]): readonly (readonly [string, string])[] =>
  dirs.flatMap((dir) =>
    sourceFiles(dir).map((file) => [file, readFileSync(join(root, file), "utf8")] as const),
  );

// Resolves `${NAME}` against the scanned string constants (iterated, so a
// constant built from another resolves too); any other substitution becomes
// "x", the shape a runtime value takes in the classifier's eyes.
const resolver = (sources: readonly (readonly [string, string])[]) => {
  const constants = new Map<string, string>();
  for (const [, src] of sources) {
    for (const match of src.matchAll(STRING_CONSTANT)) {
      const [, name, , value] = match;
      if (name && value !== undefined && !constants.has(name)) constants.set(name, value);
    }
  }
  const resolve = (text: string, depth = 0): string =>
    text.replace(/\$\{\s*([A-Za-z_$][\w$.]*)\s*\}|\$\{[^}]*\}/g, (_whole, name?: string) => {
      const value = name ? constants.get(name) : undefined;
      return value !== undefined && depth < 4 ? resolve(value, depth + 1) : "x";
    });
  return { constants, resolve };
};

/**
 * Every distinct message the wallet's own code throws or replies with under
 * `dirs`, with one file that mints it. Templates are resolved against string
 * constants; unresolved substitutions read as "x".
 */
export const thrownMessages = (dirs: readonly string[]): readonly ThrownMessage[] => {
  const sources = readSources(dirs);
  const { constants, resolve } = resolver(sources);
  const found = new Map<string, string>();
  const add = (raw: string | undefined, file: string): void => {
    if (raw === undefined) return;
    const text = resolve(raw).trim();
    if (text.length >= 3 && /\s/.test(text) && !found.has(text)) found.set(text, file);
  };
  for (const [file, src] of sources) {
    for (const match of src.matchAll(THROWN)) {
      if (match[1] && /Error|Refused/.test(match[1])) add(match[3], file);
    }
    for (const match of src.matchAll(THROWN_CONSTANT)) {
      if (match[1] && /Error|Refused/.test(match[1]) && match[2])
        add(constants.get(match[2]), file);
    }
    for (const match of src.matchAll(REPLY)) add(match[2], file);
    for (const match of src.matchAll(REPLY_CONSTANT)) {
      if (match[1]) add(constants.get(match[1]), file);
    }
    for (const match of src.matchAll(INVARIANT)) add(match[2], file);
    for (const match of src.matchAll(GUARD_LITERAL)) add(match[1], file);
  }
  return [...found].map(([raw, file]) => ({ file, raw }));
};
