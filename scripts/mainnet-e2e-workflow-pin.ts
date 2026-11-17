/**
 * Exact-bytes pin for the Mainnet E2E workflow: the primary control.
 *
 * Structural checks compare what one YAML parser decodes, and GitHub's runner
 * (YamlDotNet) has been shown to decode some spellings differently. Pinning
 * the SHA-256 of the reviewed file removes that whole class: any change to
 * `mainnet-e2e.yml`, however it decodes, fails until a reviewer updates
 * {@link MAINNET_E2E_WORKFLOW_SHA256} in the same change. The structural
 * checks stay as defence in depth and as the statement of what was reviewed.
 *
 * `source` is the text `readWorkflowSources` returns (`readFile(…, "utf8")`,
 * which keeps a byte-order mark). Its UTF-8 encoding is the file's bytes:
 * invalid UTF-8 would decode to U+FFFD, which cannot appear in the reviewed
 * text. Nothing is normalised, so a BOM, CRLF or a missing final LF changes
 * the hash and is refused. `.gitattributes` marks the file `-text` so git
 * never converts its line endings between the repository and a checkout.
 */
import { createHash } from "node:crypto";

/**
 * SHA-256 of the reviewed `.github/workflows/mainnet-e2e.yml` bytes.
 *
 * To update after changing the workflow: review the YAML diff itself (the
 * structural policy must also pass), then set this to the output of
 * `sha256sum .github/workflows/mainnet-e2e.yml` in the same pull request,
 * for code-owner review alongside the workflow.
 */
export const MAINNET_E2E_WORKFLOW_SHA256 =
  "34059ad23760ee9dafc3c65d7189493a6532b57a5f551512e7b967b5d2ac5076";

/** Stable start of the failure reported when the workflow bytes are not the reviewed ones. */
export const PIN_FAILURE =
  ".github/workflows/mainnet-e2e.yml is not the reviewed file: review the diff, then update MAINNET_E2E_WORKFLOW_SHA256 in scripts/mainnet-e2e-workflow-pin.ts";

/** The pin failure for `source`, naming its actual SHA-256, or none when it matches. Pure. */
export const mainnetE2ePinFailures = (source: string): string[] => {
  const actual = createHash("sha256").update(source, "utf8").digest("hex");
  return actual === MAINNET_E2E_WORKFLOW_SHA256 ? [] : [`${PIN_FAILURE} (now ${actual})`];
};
