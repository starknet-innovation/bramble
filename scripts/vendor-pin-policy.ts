/**
 * Shared static checks for source-vendoring scripts.
 */

// Vendor scripts spell commands as string arrays and workflows spell them as
// shell lines, so quotes and commas flatten to whitespace before any command
// pattern is matched. Matching never crosses a newline: a word ending one line
// must not join a word starting the next into a command that was never written.
const commandText = (text: string): string => text.replace(/["',]/g, " ");

// Package-manager invocations that decide *which code executes* at build time
// instead of reading it out of a lockfile. Each one runs whatever currently
// answers to a bare name, so no commit pin, integrity hash, or artifact digest
// taken afterwards covers it — the code has already run, with write access to
// the workspace the later checks read.
const DYNAMIC_EXECUTION_RULES: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  {
    pattern: /\bnpx\b/,
    reason: "downloads and runs whatever package currently answers that name",
  },
  {
    pattern: /\bbunx\b/,
    reason: "downloads and runs whatever package currently answers that name",
  },
  {
    pattern: /\bbun[^\S\n]+x\b/,
    reason: "downloads and runs whatever package currently answers that name",
  },
  {
    pattern: /\bnpm[^\S\n]+exec\b/,
    reason: "downloads and runs whatever package currently answers that name",
  },
  {
    pattern: /\b(?:pnpm|yarn)[^\S\n]+dlx\b/,
    reason: "downloads and runs whatever package currently answers that name",
  },
  {
    pattern: /\bnpm[^\S\n]+(?:install|add|i)\b/,
    reason: "resolves dependencies outside the lockfile; use `npm ci --ignore-scripts`",
  },
  {
    pattern: /\b(?:curl|wget)\b[^\n]*\|[^\S\n]*(?:ba|z|k)?sh\b/,
    reason: "pipes a downloaded script straight into a shell",
  },
];

const NPM_RUN_PATTERN = /\bnpm[^\S\n]+run[^\S\n]+([\w:@./-]+)/g;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

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
 * Reports every dynamic package execution in a body of command text — a vendor
 * script's source, a workflow's `run:` steps, or one package script's command
 * line. `origin` names what is being described and prefixes each failure.
 *
 * This is the durable half of the privacy-SDK build-provenance fix: pinning one
 * tool removes one instance, whereas refusing build-time name resolution
 * anywhere in the vendoring path removes the class. Pure text analysis, so it
 * holds for commands that only ever run on a release machine.
 */
export const dynamicExecutionFailures = (text: string, origin: string): readonly string[] => {
  const failures: string[] = [];
  const normalized = commandText(text);
  for (const rule of DYNAMIC_EXECUTION_RULES) {
    const matched = normalized.match(rule.pattern)?.[0];
    if (matched !== undefined) {
      failures.push(`${origin} must not run \`${matched.trim()}\`: it ${rule.reason}`);
    }
  }
  return failures;
};

/**
 * Extracts the package-script names a body of command text hands to `npm run`,
 * de-duplicated and in first-seen order. A vendoring step that runs an upstream
 * package script delegates the choice of executable to the upstream manifest,
 * which is why callers resolve those names rather than trusting them.
 */
export const npmRunTargets = (text: string): readonly string[] => {
  const targets: string[] = [];
  for (const match of commandText(text).matchAll(NPM_RUN_PATTERN)) {
    const target = match[1];
    if (target !== undefined && !targets.includes(target)) {
      targets.push(target);
    }
  }
  return targets;
};

/**
 * Resolves one npm package script through its `npm run` chain and reports every
 * dynamic package execution reachable from it. `origin` names the manifest the
 * scripts came from. Fails closed in both directions: a named script the
 * manifest does not define is itself a failure, and cycles terminate rather
 * than recursing.
 */
export const packageScriptFailures = (input: {
  readonly origin: string;
  readonly scripts: Readonly<Record<string, unknown>>;
  readonly target: string;
}): readonly string[] => {
  const failures: string[] = [];
  const seen = new Set<string>();
  const queue: string[] = [input.target];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const body = input.scripts[name];
    if (typeof body !== "string") {
      failures.push(`${input.origin} does not define the \`${name}\` package script`);
      continue;
    }
    failures.push(...dynamicExecutionFailures(body, `${input.origin} script \`${name}\``));
    queue.push(...npmRunTargets(body));
  }
  return failures;
};

/**
 * The npm packages the vendored privacy SDK's browser build actually executes:
 * the esbuild JavaScript API and the platform binary it spawns. Both are locked
 * with integrity hashes inside the commit-pinned upstream checkout. The list
 * lives here so the vendoring step and `check:privacy` cannot disagree about
 * which executables had to come from that lockfile.
 */
export const privacyBuildPackages = (platform: string, arch: string): readonly string[] => [
  "esbuild",
  `@esbuild/${platform}-${arch}`,
];

/**
 * Reports build tools an npm project resolves outside its lockfile. `lock` is
 * the parsed `package-lock.json` and each entry in `packages` is a package name
 * with the version actually installed on disk, so a lock entry that is absent,
 * carries a different version, or has no integrity hash all fail. Pure: callers
 * keep the file reads at their own boundary. An unparseable lock fails rather
 * than reporting nothing to verify.
 */
export const lockedPackageFailures = (input: {
  readonly lock: unknown;
  readonly lockPath: string;
  readonly packages: readonly { readonly name: string; readonly version: string }[];
}): readonly string[] => {
  const root = asRecord(input.lock);
  const entries = root === undefined ? undefined : asRecord(root["packages"]);
  if (entries === undefined) {
    return [`${input.lockPath} is not an npm lockfile with a packages map`];
  }
  const failures: string[] = [];
  for (const pkg of input.packages) {
    const entry = asRecord(entries[`node_modules/${pkg.name}`]);
    if (entry === undefined) {
      failures.push(`${input.lockPath} does not lock the build tool ${pkg.name}`);
      continue;
    }
    if (entry["version"] !== pkg.version) {
      failures.push(
        `${input.lockPath} locks ${pkg.name} ${String(entry["version"])}, but ${pkg.version} is installed`,
      );
    }
    const integrity = entry["integrity"];
    if (typeof integrity !== "string" || integrity === "") {
      failures.push(`${input.lockPath} locks ${pkg.name} without an integrity hash`);
    }
  }
  return failures;
};

/**
 * A vendored runtime file and the SHA-256 its reviewed build produced. Only
 * artifacts every builder can reproduce byte for byte belong here: a fetched
 * published file, or a build output derived from the pinned source alone — the
 * wasm-bindgen glue, a JavaScript bundle, a source map with repository-relative
 * paths. A digest over a natively compiled artifact does not belong here, even
 * with the compiler release pinned: the toolchain around it still reaches the
 * bytes, so the literal holds only on the machine that wrote it and every other
 * builder fails a check that verified nothing. Such an artifact stays unpinned
 * and its gate must say so in its header, naming what covers it instead and how
 * the gap closes (see `scripts/check-krusty-adapter.ts`).
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
