/**
 * Character allowlist for a reviewed workflow's raw source, checked before
 * any parsing.
 *
 * Parsers disagree on what ends a line. `yaml` 2.x keeps a comment running
 * through a bare CR, U+0085, U+2028 or U+2029, while GitHub's runner
 * (YamlDotNet) ends the comment there, so text after one is a comment to the
 * policy and a step, or a `%YAML` directive, to GitHub. Invisible and
 * bidirectional characters can likewise make a reviewed diff read
 * differently from what runs. Rather than list the dangerous characters,
 * this allows only what the reviewed workflows need: printable ASCII, LF, CR
 * immediately followed by LF, one byte-order mark at the very start, and the
 * em dash (U+2014) used in messages. Everything else fails closed, with its
 * line and code point. Tabs are refused too: YAML forbids them in
 * indentation, and none of the reviewed workflows uses one.
 */

const EM_DASH = 0x2014;
const BOM = 0xfeff;

const allowed = (code: number, index: number, source: string): boolean =>
  (code >= 0x20 && code <= 0x7e) ||
  code === 0x0a ||
  (code === 0x0d && source.charCodeAt(index + 1) === 0x0a) ||
  (code === BOM && index === 0) ||
  code === EM_DASH;

const codePoint = (code: number): string => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * Every character in `source` outside the allowlist, as failures naming the
 * 1-based line (counted by LF) and the code point, prefixed with `path`; and
 * a failure when the source does not end with a line feed.
 * Reads the original text, code point by code point; nothing is normalised
 * first. Pure.
 */
export const sourceCharacterFailures = (source: string, path: string): string[] => {
  const failures: string[] = [];
  let line = 1;
  let index = 0;
  for (const character of source) {
    const code = character.codePointAt(0) ?? 0;
    if (!allowed(code, index, source)) {
      failures.push(`${path} line ${line} must not contain ${codePoint(code)}`);
    }
    if (code === 0x0a) line += 1;
    index += character.length;
  }
  // Read as-is, not with a newline appended: parsers disagree on whether a
  // block scalar at the end of an unterminated file keeps its final newline.
  if (!source.endsWith("\n")) failures.push(`${path} must end with a line feed`);
  return failures;
};
