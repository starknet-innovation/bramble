/**
 * Exact-bytes pin of a reviewed workflow file.
 *
 * Structural checks judge what a parser reads, so they are only as strong as
 * the agreement between that parser and GitHub's runner. A pin needs no
 * parser: the policy states the SHA-256 of the reviewed file, and any change,
 * however it would be read, fails until the policy is updated with it. The
 * pin lives in a policy module, so changing the workflow also changes a
 * reviewed script, and the structural checks still run on whatever the new
 * pin admits.
 *
 * The digest is taken over the UTF-8 encoding of the source text, which is
 * the file's exact bytes for any file the character allowlist accepts
 * (`workflow-source-characters.ts`); a test compares it with the raw bytes on
 * disk.
 */
import { createHash } from "node:crypto";

/** Lower-case hex SHA-256 of `source`'s UTF-8 bytes. Pure. */
export const sourceSha256 = (source: string): string =>
  createHash("sha256").update(source, "utf8").digest("hex");

/**
 * A single failure, prefixed with `path`, when `source` is not byte for byte
 * the reviewed file whose SHA-256 is `expected`; otherwise none. `constant`
 * names where the pin is kept, so the failure says what a reviewed change must
 * update. Pure.
 */
export const sourcePinFailures = (
  source: string,
  path: string,
  expected: string,
  constant: string,
): string[] =>
  sourceSha256(source) === expected
    ? []
    : [
        `${path} must be byte for byte the reviewed file (SHA-256 ${expected}); a reviewed change updates ${constant}`,
      ];
