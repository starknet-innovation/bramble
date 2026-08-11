/**
 * Shared static checks for source-vendoring scripts.
 */

// One expression owns the pin's shape. `vendorPinFailures` enforces it in the
// vendor script and `vendorRevisionPin` reads the value back out of that same
// literal, so a verifier can never disagree with the vendoring step about which
// commit was fetched.
const revisionPinPattern = (constant: string): RegExp =>
  new RegExp(`const ${constant} = "([0-9a-f]{40})";`);

/**
 * Reports moving-branch or malformed revision pins in a vendor script.
 */
export const vendorPinFailures = (
  source: string,
  script: string,
  constant: string,
): readonly string[] => {
  const failures: string[] = [];
  if (!revisionPinPattern(constant).test(source)) {
    failures.push(`${script} must pin a commit in ${constant}`);
  }
  if (source.includes('"pull"')) {
    failures.push(`${script} must not follow a moving branch`);
  }
  return failures;
};

/**
 * Reads the 40-hex commit a vendor script pins so a verifier can compare a
 * vendored checkout against the same literal the vendoring step used, instead
 * of keeping a second copy that can drift. Throws when the pin is missing or
 * malformed: every caller is a build gate that must fail closed rather than
 * silently skip provenance verification.
 */
export const vendorRevisionPin = (source: string, script: string, constant: string): string => {
  const pin = source.match(revisionPinPattern(constant))?.[1];
  if (pin === undefined) {
    throw new Error(`${script} must pin a commit in ${constant}`);
  }
  return pin;
};

/**
 * A vendored runtime file and the SHA-256 its reviewed build produced. Only
 * build outputs that are byte-reproducible across machines belong here. When an
 * artifact's bytes depend on the builder's paths or toolchain, the answer is to
 * pin the build until they do not (see `scripts/vendor-krusty.ts`) rather than
 * to leave the shipped file unpinned: a digest nobody can reproduce is worse
 * than useless, but an executing artifact with no digest is unverifiable.
 */
export type VendoredArtifact = {
  readonly digest: string;
  readonly expectedDigest: string;
  readonly path: string;
};

/**
 * Everything a verifier observed about one vendored checkout: the commit its
 * vendor script pins, the commit the checkout actually sits on, the porcelain
 * worktree status, and the digests of the runtime files it produced.
 */
export type VendorProvenance = {
  readonly artifacts: readonly VendoredArtifact[];
  readonly head: string;
  readonly name: string;
  readonly pinnedRevision: string;
  readonly worktreeStatus: string;
};

/**
 * Returns every provenance mismatch between a vendored checkout and its pin: a
 * head that is not the pinned commit (a commit hash binds the whole source
 * tree, so equality proves the source), a modified worktree, or a runtime file
 * that does not match its reviewed digest. Pure so callers keep the git and
 * filesystem reads at their own boundary; an empty result is the only outcome a
 * build gate may treat as verified.
 */
export const vendorProvenanceFailures = (provenance: VendorProvenance): readonly string[] => {
  const failures: string[] = [];
  if (provenance.head !== provenance.pinnedRevision) {
    failures.push(`${provenance.name} checkout does not match the pinned revision`);
  }
  if (provenance.worktreeStatus.trim() !== "") {
    failures.push(`${provenance.name} checkout has local modifications`);
  }
  for (const artifact of provenance.artifacts) {
    if (artifact.digest !== artifact.expectedDigest) {
      failures.push(`${artifact.path} does not match the reviewed artifact digest`);
    }
  }
  return failures;
};
