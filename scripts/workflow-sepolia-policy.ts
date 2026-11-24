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
 * step. All four steps are pinned as text, the live steps whole, `run:`
 * included: they write the secret to a file, and an added line could copy it
 * past the `trap` or hand it to later steps. The live steps are also read from
 * the parsed YAML (`workflow-sepolia-document.ts`), so no key can be added to
 * them however it is spelled, and the nightly job must run one at a time
 * (`concurrency`), so two runs never race for nonces.
 * Every workflow is also refused the forms that hand every secret on at once,
 * and recording a Sepolia tape (network traffic not fit for a public
 * repository). The secrets context ignores case and accepts bracket access, so
 * references are matched in every spelling. This catches drift and careless
 * edits; a determined hostile edit of the workflow is a review matter.
 */

import { requireText, workflowPath } from "./workflow-policy-text";
import { type PinnedStep, sepoliaDocumentFailures } from "./workflow-sepolia-document";

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
  /** The live step's `id:`, as the parsed check finds it. */
  readonly liveId: string;
  readonly configuredStep: string;
  readonly liveStep: string;
  readonly what: string;
  readonly step: string;
  /** True when two runs of the job holding this secret must never overlap. */
  readonly oneAtATime?: boolean;
};

const CONFINED: readonly Confined[] = [
  {
    reference: /secrets\s*(?:\.|\[\s*['"])\s*bramble_sepolia_seeds\b/gi,
    liveId: "sepolia",
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
        run: |
          set -euo pipefail
          if [ -z "\${BRAMBLE_SEPOLIA_SEEDS:-}" ]; then
            echo "::error::The BRAMBLE_SEPOLIA_SEEDS secret is not set (tools/vendor-dataset/README.md)."
            exit 1
          fi
          if [ ! -f tools/vendor-dataset/verify-sepolia.ts ]; then
            echo "::error::This release branch predates the Sepolia runner (issue 821)."
            exit 1
          fi
          umask 077
          seeds="$RUNNER_TEMP/sepolia-seeds.env"
          trap 'rm -f "$seeds"' EXIT
          printf '%s\\n' "$BRAMBLE_SEPOLIA_SEEDS" > "$seeds"
          unset BRAMBLE_SEPOLIA_SEEDS
          # GitHub masks a multi-line secret line by line, and a line here is
          # NAME="value", so each value is masked on its own as well.
          while IFS= read -r line; do
            value="\${line#*=}"
            value="\${value%$'\\r'}"
            value="\${value#"\${value%%[![:space:]]*}"}"
            value="\${value%"\${value##*[![:space:]]}"}"
            value="\${value#\\"}"
            value="\${value%\\"}"
            value="\${value#"\${value%%[![:space:]]*}"}"
            value="\${value%"\${value##*[![:space:]]}"}"
            if [ -n "$value" ]; then echo "::add-mask::$value"; fi
          done < "$seeds"
          # The newest committed scorecard, if this branch has one (dated names sort in order).
          set -- "$RUNNER_TEMP/sepolia/scorecard.json"
          for previous in tools/vendor-dataset/verification-sepolia-*.json; do
            if [ -f "$previous" ]; then set -- "$RUNNER_TEMP/sepolia/scorecard.json" "$previous"; fi
          done
          mkdir -p "$RUNNER_TEMP/sepolia"
          BRAMBLE_DATASET_ENV_FILE="$seeds" BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia \\
            bun tools/vendor-dataset/verify-sepolia.ts "$@"
`,
    what: "the Sepolia seed secret",
    step: "the Sepolia seeds",
  },
  {
    reference: /secrets\s*(?:\.|\[\s*['"])\s*bramble_sepolia_txn_seed\b/gi,
    liveId: "sepolia_txn",
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
        run: |
          set -euo pipefail
          if [ ! -f tools/vendor-dataset/sepolia-bank-runway.ts ]; then
            echo "::error::This release branch predates the Sepolia send run (issue 976)."
            exit 1
          fi
          umask 077
          seeds="$RUNNER_TEMP/sepolia-txn-seed.env"
          trap 'rm -f "$seeds"' EXIT
          echo "::add-mask::$BRAMBLE_SEPOLIA_TXN_SEED"
          printf 'BRAMBLE_DATASET_SEED_S_TXN="%s"\\n' "\${BRAMBLE_SEPOLIA_TXN_SEED//[$'\\r\\n']/}" > "$seeds"
          unset BRAMBLE_SEPOLIA_TXN_SEED
          export BRAMBLE_DATASET_ENV_FILE="$seeds" BRAMBLE_E2E_LIVE_NETWORK=1 BRAMBLE_DATASET_NETWORK=sepolia
          bun tools/vendor-dataset/sepolia-bank-runway.ts
          status=0
          bun tools/vendor-dataset/verify-sepolia-sends.ts || status=1
          bun tools/vendor-dataset/verify-sepolia-deploys.ts || status=1
          exit "$status"
`,
    what: "the Sepolia send seed secret",
    step: "the Sepolia send seed",
    oneAtATime: true,
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
  return failures;
};

const pinnedStep = (path: string, secret: Confined): PinnedStep => ({
  added: `${path} must not add to the live step holding ${secret.step}`,
  id: secret.liveId,
  text: secret.liveStep,
  ...(secret.oneAtATime
    ? { overlap: `${path} must run the job holding ${secret.step} one at a time` }
    : {}),
});

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
    ...(path === workflowPath("nightly.yml")
      ? sepoliaDocumentFailures(
          path,
          source,
          CONFINED.filter((secret) => (source.match(secret.reference)?.length ?? 0) > 0).map(
            (secret) => pinnedStep(path, secret),
          ),
        )
      : []),
  ];
};
