/**
 * Policy for the two secrets the Sepolia nightly gates hold. Split from the
 * general workflow policy, which was at its size limit.
 *
 * - `BRAMBLE_SEPOLIA_SEEDS` (issue 821): the import run's testnet-only seed
 *   file, which still controls the funded import fixtures.
 * - `BRAMBLE_SEPOLIA_TXN_SEED` (issue 976): the S-TXN phrase, which controls
 *   the send run's testnet accounts and the bank its deploy run spends from.
 *
 * Only `nightly.yml` may name either, each exactly twice: once as a boolean
 * saying whether it is configured, and once in the environment of its own live
 * step, which may not write to later steps. All four steps are pinned as text.
 * Every workflow is also refused the forms that hand every secret on at once,
 * and recording a Sepolia tape (network traffic not fit for a public
 * repository). The secrets context ignores case and accepts bracket access, so
 * references are matched in every spelling. This catches drift and careless
 * edits; a determined hostile edit of the workflow is a review matter.
 */
import { requireText, workflowPath } from "./workflow-policy-text";

const GITHUB_EXPRESSION = "$" + "{{";
// Expression functions and keys ignore case, and spacing is free.
const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ["toJSON(secrets)", /tojson\s*\(\s*secrets\s*\)/i],
  ["secrets: inherit", /secrets\s*:\s*inherit/i],
  ["BRAMBLE_SEPOLIA_RECORD", /BRAMBLE_SEPOLIA_RECORD/i],
];

/** One confined secret: how it is referenced, its two pinned steps, and how failures name it. */
type Confined = {
  readonly reference: RegExp;
  readonly configuredStep: string;
  readonly liveStep: string;
  readonly what: string;
  readonly step: string;
};

const CONFINED: readonly Confined[] = [
  {
    reference: /secrets\s*(?:\.|\[\s*['"])\s*bramble_sepolia_seeds\b/gi,
    configuredStep: `      - name: Sepolia seeds configured
        id: sepolia_seeds
        env:
          CONFIGURED: ${GITHUB_EXPRESSION} secrets.BRAMBLE_SEPOLIA_SEEDS != '' }}
        run: echo "configured=$CONFIGURED" >> "$GITHUB_OUTPUT"
`,
    liveStep: `      - name: Sepolia import paths (live)
        id: sepolia
        if: steps.sepolia_seeds.outputs.configured == 'true'
        continue-on-error: true
        env:
          BRAMBLE_SEPOLIA_SEEDS: ${GITHUB_EXPRESSION} secrets.BRAMBLE_SEPOLIA_SEEDS }}
`,
    what: "the Sepolia seed secret",
    step: "the Sepolia seeds",
  },
  {
    reference: /secrets\s*(?:\.|\[\s*['"])\s*bramble_sepolia_txn_seed\b/gi,
    configuredStep: `      - name: Sepolia send seed configured
        id: sepolia_txn_seed
        env:
          CONFIGURED: ${GITHUB_EXPRESSION} secrets.BRAMBLE_SEPOLIA_TXN_SEED != '' }}
        run: echo "configured=$CONFIGURED" >> "$GITHUB_OUTPUT"
`,
    liveStep: `      - name: Sepolia sends and deploys (live)
        id: sepolia_txn
        if: steps.sepolia_txn_seed.outputs.configured == 'true'
        continue-on-error: true
        env:
          BRAMBLE_SEPOLIA_TXN_SEED: ${GITHUB_EXPRESSION} secrets.BRAMBLE_SEPOLIA_TXN_SEED }}
`,
    what: "the Sepolia send seed secret",
    step: "the Sepolia send seed",
  },
];

const confinedFailures = (path: string, source: string, secret: Confined): string[] => {
  const failures: string[] = [];
  const uses = source.match(secret.reference)?.length ?? 0;
  if (uses === 0) return failures;
  if (path !== workflowPath("nightly.yml")) return [`${path} must not reference ${secret.what}`];
  requireText(
    failures,
    source,
    secret.configuredStep,
    `${path} must check ${secret.step} only as a boolean`,
  );
  requireText(
    failures,
    source,
    secret.liveStep,
    `${path} must scope ${secret.step} to its live Sepolia step`,
  );
  if (uses !== 2) failures.push(`${path} must reference ${secret.what} exactly twice`);
  const at = source.indexOf(secret.liveStep);
  const step = at < 0 ? "" : source.slice(at, source.indexOf("\n      - ", at + 1));
  if (/GITHUB_(?:ENV|OUTPUT|PATH|STEP_SUMMARY)/.test(step)) {
    failures.push(`${path} must not let the live step holding ${secret.step} write to later steps`);
  }
  return failures;
};

/**
 * Returns the Sepolia-secret policy violations in one workflow's source. Pure:
 * it reads only the text it is given.
 */
export const sepoliaSeedsFailures = (name: string, source: string): string[] => {
  const path = workflowPath(name);
  return [
    ...FORBIDDEN.filter(([, pattern]) => pattern.test(source)).map(
      ([label]) => `${path} must not use ${label}`,
    ),
    ...CONFINED.flatMap((secret) => confinedFailures(path, source, secret)),
  ];
};
