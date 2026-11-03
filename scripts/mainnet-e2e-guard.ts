/**
 * Decides whether a live Starknet mainnet suite may run.
 *
 * Local runs, where `CI` is unset, are unchanged. Any other CI is refused.
 * GitHub Actions may opt in only when the runner itself reports the reviewed
 * Mainnet E2E workflow on `main` in this repository, and the workflow has
 * named the `mainnet-e2e` environment. A release-branch test cannot grant
 * itself that context: `GITHUB_WORKFLOW_REF` is set by the runner from the
 * workflow file that was dispatched. The check does not inspect secrets and
 * its refusal text never echoes the environment.
 */

export const MAINNET_E2E_REPOSITORY = "starknet-innovation/bramble";
export const MAINNET_E2E_WORKFLOW_NAME = "Mainnet E2E";
export const MAINNET_E2E_WORKFLOW_FILE = ".github/workflows/mainnet-e2e.yml";
export const MAINNET_E2E_ENVIRONMENT = "mainnet-e2e";
export const MAINNET_E2E_REF = "refs/heads/main";
export const MAINNET_E2E_CI_OPT_IN = "1";
export const STRK20_CI_OPT_IN = "1";

/** Environment the guard reads. Tests pass a fixture instead of `process.env`. */
export type MainnetCiEnv = Readonly<Record<string, string | undefined>>;

/** Result of {@link decideMainnetCi}. `refused.reason` is safe to print. */
export type MainnetCiDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "local" }
  | { readonly kind: "refused"; readonly reason: string };

const ALLOWED_EVENTS = new Set(["schedule", "workflow_dispatch"]);

/**
 * Workflow ref GitHub sets when this file runs from `main`. The runner's
 * value is `owner/repo/.github/workflows/file.yml@refs/heads/main`.
 */
export const mainnetE2eWorkflowRef = (): string =>
  `${MAINNET_E2E_REPOSITORY}/${MAINNET_E2E_WORKFLOW_FILE}@${MAINNET_E2E_REF}`;

const refused = (reason: string): MainnetCiDecision => ({ kind: "refused", reason });

/**
 * Classifies `env` as a local run, an allowed Mainnet E2E run, or a refusal.
 * Pure: it does not read `process.env` and does not throw.
 */
export const decideMainnetCi = (env: MainnetCiEnv): MainnetCiDecision => {
  if (!env["CI"]) return { kind: "local" };
  if (env["BRAMBLE_MAINNET_E2E_CI"] !== MAINNET_E2E_CI_OPT_IN) {
    return refused("The live-mainnet suite is local-only unless BRAMBLE_MAINNET_E2E_CI=1");
  }
  if (env["GITHUB_ACTIONS"] !== "true") {
    return refused("BRAMBLE_MAINNET_E2E_CI is only honored inside GitHub Actions");
  }
  if (env["GITHUB_REPOSITORY"] !== MAINNET_E2E_REPOSITORY) {
    return refused("The live-mainnet suite refuses to run outside starknet-innovation/bramble");
  }
  if (env["GITHUB_WORKFLOW"] !== MAINNET_E2E_WORKFLOW_NAME) {
    return refused("BRAMBLE_MAINNET_E2E_CI is only honored on the Mainnet E2E workflow");
  }
  if (env["GITHUB_WORKFLOW_REF"] !== mainnetE2eWorkflowRef()) {
    return refused("BRAMBLE_MAINNET_E2E_CI is only honored from the workflow file on main");
  }
  if (env["GITHUB_REF"] !== MAINNET_E2E_REF) {
    return refused("The live-mainnet suite only runs from the workflow on main");
  }
  const event = env["GITHUB_EVENT_NAME"];
  if (event === undefined || !ALLOWED_EVENTS.has(event)) {
    return refused("The live-mainnet suite refuses this GitHub Actions event");
  }
  if (env["BRAMBLE_MAINNET_E2E_ENVIRONMENT"] !== MAINNET_E2E_ENVIRONMENT) {
    return refused("BRAMBLE_MAINNET_E2E_CI requires the mainnet-e2e environment");
  }
  return { kind: "allowed" };
};

/**
 * Throws the refusal reason when {@link decideMainnetCi} refuses. Returns the
 * decision otherwise. The thrown message does not include environment values.
 */
export const assertLiveMainnetAllowed = (env: MainnetCiEnv): MainnetCiDecision => {
  const decision = decideMainnetCi(env);
  if (decision.kind === "refused") throw new Error(decision.reason);
  return decision;
};

/**
 * Whether the CI opt-in is active and the STRK20 lifecycle should stay out of
 * the run. Local runs return false so the existing suite is unchanged. The
 * lifecycle's pool fee is far above the standard hot-wallet cap, so CI runs
 * it only when `BRAMBLE_STRK20_E2E_CI=1`.
 */
export const strk20LifecycleExcluded = (env: MainnetCiEnv): boolean =>
  decideMainnetCi(env).kind === "allowed" && env["BRAMBLE_STRK20_E2E_CI"] !== STRK20_CI_OPT_IN;
