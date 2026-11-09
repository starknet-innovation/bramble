/**
 * Pure checks for the Ledger E2E supply-chain pins (`scripts/ledger-app-pins.ts`).
 * Kept apart from the filesystem and git reads in `check-ledger-app.ts` so the
 * rules are unit-tested (`tests/scripts/ledger-app-pins.test.ts`).
 */

const IMAGE_BY_DIGEST = /^ghcr\.io\/ledgerhq\/[a-z0-9/_-]+@sha256:[0-9a-f]{64}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The pin values a check reads. */
export type LedgerAppPins = {
  readonly binaries: Readonly<Record<string, { readonly sha256: string | null }>>;
  readonly builderImage: string;
  readonly revision: string;
  readonly speculosImage: string;
};

/**
 * Reports malformed pins: a revision that is not a full commit, an image named
 * by tag rather than digest (or outside Ledger's ghcr namespace), or a binary
 * hash that is neither unrecorded (null) nor a SHA-256.
 */
export const ledgerAppPinFailures = (pins: LedgerAppPins): readonly string[] => {
  const failures: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(pins.revision)) {
    failures.push("app-starknet must be pinned to a full 40-hex commit");
  }
  for (const [name, image] of [
    ["ledger-app-builder", pins.builderImage],
    ["Speculos", pins.speculosImage],
  ] as const) {
    if (!IMAGE_BY_DIGEST.test(image)) {
      failures.push(`${name} image must be a ghcr.io/ledgerhq image pinned by sha256 digest`);
    }
  }
  for (const [model, binary] of Object.entries(pins.binaries)) {
    if (binary.sha256 !== null && !SHA256.test(binary.sha256)) {
      failures.push(`${model} app binary hash must be null or a lowercase SHA-256`);
    }
  }
  return failures;
};

/**
 * Reports a built binary that is not covered by a recorded hash. `digest` is
 * null when the binary is absent, which is not a failure: CI does not build
 * the app, and the Speculos runner refuses to start without a recorded match.
 */
export const ledgerAppBinaryFailure = (
  model: string,
  pinned: string | null,
  digest: string | null,
): string | null => {
  if (digest === null) {
    return null;
  }
  if (pinned === null) {
    return `${model} app binary exists but its hash is not recorded in scripts/ledger-app-pins.ts`;
  }
  return digest === pinned ? null : `${model} app binary does not match its recorded hash`;
};

/**
 * The requested models whose binary hash is still unrecorded (null). The CI
 * test mode fails on any, before building anything: without a recorded hash
 * the Speculos runner refuses the binary, so a run could only fail later or,
 * worse, be mistaken for a pass.
 */
export const unrecordedLedgerModels = (
  binaries: LedgerAppPins["binaries"],
  models: readonly string[],
): readonly string[] => models.filter((model) => binaries[model]?.sha256 === null);

/** One built binary as the record mode reports it. `digest` is null when absent. */
export type LedgerHashRow = {
  readonly digest: string | null;
  readonly model: string;
  readonly recorded: string | null;
};

const rowStatus = ({ digest, recorded }: LedgerHashRow): string => {
  if (digest === null) {
    return "MISSING: not built";
  }
  if (recorded === null) {
    return "unrecorded: review, then record";
  }
  return digest === recorded ? "matches the recorded hash" : "DIFFERS from the recorded hash";
};

/**
 * The Markdown report record mode writes to the job summary. It states that no
 * test ran, so the report is never read as a test result. `complete` is false
 * when any binary is missing or differs from its recorded hash, which fails the
 * record job.
 */
export const ledgerHashReport = (
  rows: readonly LedgerHashRow[],
): { readonly complete: boolean; readonly markdown: string } => {
  const lines = [
    "## Ledger app binary hashes (record mode: no tests ran)",
    "",
    "| Model | SHA-256 | Status |",
    "| --- | --- | --- |",
    ...rows.map((row) => `| ${row.model} | \`${row.digest ?? "-"}\` | ${rowStatus(row)} |`),
    "",
    "Review these against a second build before recording them in `LEDGER_APP_BINARIES` " +
      "(`scripts/ledger-app-pins.ts`) in a reviewed pull request. See `tests/e2e/ledger/README.md`.",
    "",
  ];
  const complete = rows.every(
    (row) => row.digest !== null && (row.recorded === null || row.recorded === row.digest),
  );
  return { complete, markdown: lines.join("\n") };
};
