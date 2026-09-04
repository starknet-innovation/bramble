/**
 * Local guard for release-branch immutability (issue #302).
 *
 * A `release/v*` branch becomes immutable the moment `main` merges its tip:
 * commits landed after that point are orphaned from the development line
 * (`release/v0.10` took #279/#284 that way). `pr-guards` in CI rejects PRs into
 * such a branch; this is the same rule enforced locally, before the work is
 * written, via `.githooks/pre-commit` and `.githooks/pre-push`.
 *
 * {@link evaluateReleaseBranchGuard} is PURE so the policy is unit tested
 * without a checkout; only {@link main} runs git and reads the pre-push stdin.
 * Both fail CLOSED: an integration question that cannot be answered (no
 * `origin/main`, unknown object, failed fetch) refuses the operation and asks
 * for a fetch rather than assuming the branch is still open.
 */
import { isReleaseBranch } from "./release-version";

/** Which local operation is being guarded; only the message differs. */
export type GuardAction = "commit" | "push";

/** Verdict for one operation: allowed, or refused with an operator-facing reason. */
export type GuardVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Inputs to {@link evaluateReleaseBranchGuard}. */
export interface GuardInput {
  readonly action: GuardAction;
  /** The branch being extended, e.g. `release/v0.10` (short name, no `refs/heads/`). */
  readonly branch: string;
  /**
   * Whether the tip being extended has already been merged into `origin/main`
   * — `null` when that could not be determined, which fails closed.
   */
  readonly integrated: boolean | null;
}

/**
 * The policy: non-release branches are unaffected; a release branch whose tip
 * `main` has already merged is immutable; an unanswerable question refuses too.
 */
export const evaluateReleaseBranchGuard = (input: GuardInput): GuardVerdict => {
  if (!isReleaseBranch(input.branch)) {
    return { ok: true };
  }
  if (input.integrated === null) {
    return {
      ok: false,
      reason: `release-branch guard: could not determine whether ${input.branch} is already integrated into main. Run \`git fetch origin main ${input.branch}\` and retry; refusing to ${input.action} until ancestry is known.`,
    };
  }
  if (input.integrated) {
    return {
      ok: false,
      reason: `release-branch guard: ${input.branch} is already integrated into main and is immutable — a ${input.action} here would orphan the change from the development line. Cut the next patch release branch (e.g. ${nextPatchBranch(input.branch)}) and land the work there.`,
    };
  }
  return { ok: true };
};

/** The next patch release branch after `branch`, for the remediation message. */
export const nextPatchBranch = (branch: string): string => {
  const parts = branch.replace(/^release\/v/, "").split(".");
  const [major = "0", minor = "0", patch = "0"] = parts;
  return `release/v${major}.${minor}.${Number(patch) + 1}`;
};

const git = async (...args: readonly string[]): Promise<{ code: number; stdout: string }> => {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout: stdout.trim() };
};

/**
 * The non-first parents of every merge commit in `origin/main` — i.e. every
 * branch tip `main` has integrated. `null` when `origin/main` is unavailable.
 *
 * Reachability alone cannot answer "was this integrated": a release branch
 * freshly cut from `main` is reachable too, and blocking its first commit would
 * break every release. A promotion is always a merge commit (RELEASING.md), so
 * the merged-in parents are the exact set.
 */
const mergedTips = async (): Promise<ReadonlySet<string> | null> => {
  if ((await git("rev-parse", "--verify", "--quiet", "refs/remotes/origin/main")).code !== 0) {
    return null;
  }
  const merges = await git("rev-list", "--parents", "--merges", "refs/remotes/origin/main");
  if (merges.code !== 0) {
    return null;
  }
  return new Set(
    merges.stdout
      .split("\n")
      .flatMap((line) => line.trim().split(/\s+/).slice(2))
      .filter((sha) => sha.length > 0),
  );
};

/** Whether `rev` has been merged into `origin/main`; `null` when that cannot be answered. */
const integratedIntoMain = async (rev: string): Promise<boolean | null> => {
  const resolved = await git("rev-parse", "--verify", "--quiet", `${rev}^{commit}`);
  if (resolved.code !== 0) {
    return null;
  }
  const tips = await mergedTips();
  return tips === null ? null : tips.has(resolved.stdout);
};

const ZERO_SHA = /^0+$/;

/** The `refs/heads/<branch>` refs a pre-push stdin block would advance, with their remote tips. */
export const parsePrePushRefs = (
  stdin: string,
): readonly { readonly branch: string; readonly remoteSha: string }[] =>
  stdin
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([, , remoteRef, remoteSha]) =>
      remoteRef?.startsWith("refs/heads/") && remoteSha !== undefined
        ? [{ branch: remoteRef.slice("refs/heads/".length), remoteSha }]
        : [],
    );

/**
 * Whether a pushed branch's remote tip is already integrated into `main`. The
 * tip is reported by the push, so the object may not be present locally (a
 * teammate pushed it); fetch that branch once before failing closed.
 */
const remoteTipIntegrated = async (ref: {
  readonly branch: string;
  readonly remoteSha: string;
}): Promise<boolean | null> => {
  const known = await integratedIntoMain(ref.remoteSha);
  if (known !== null) {
    return known;
  }
  await git("fetch", "--quiet", "origin", ref.branch);
  return integratedIntoMain(ref.remoteSha);
};

const refuse = (reason: string): number => {
  console.error(reason);
  return 1;
};

/**
 * CLI entrypoint. `commit` guards the checked-out branch against its own tip;
 * `push` guards every pushed `release/v*` ref against the REMOTE tip reported on
 * stdin, so the first accidental commit made after integration is still caught.
 * Returns the process exit code (non-zero refuses the operation).
 */
export const main = async (argv: readonly string[]): Promise<number> => {
  const action: GuardAction = argv[0] === "push" ? "push" : "commit";

  if (action === "commit") {
    const head = await git("symbolic-ref", "--short", "--quiet", "HEAD");
    if (head.code !== 0 || !isReleaseBranch(head.stdout)) {
      return 0;
    }
    // Judge the remote tip when there is one, so a commit made after a
    // `--no-verify` bypass (local tip no longer the merged one) is still caught.
    const remoteRef = `refs/remotes/origin/${head.stdout}`;
    const hasRemote = (await git("rev-parse", "--verify", "--quiet", remoteRef)).code === 0;
    const verdict = evaluateReleaseBranchGuard({
      action,
      branch: head.stdout,
      integrated: await integratedIntoMain(hasRemote ? remoteRef : "HEAD"),
    });
    return verdict.ok ? 0 : refuse(verdict.reason);
  }

  const refs = parsePrePushRefs(await Bun.stdin.text()).filter((ref) =>
    isReleaseBranch(ref.branch),
  );
  if (refs.length === 0) {
    return 0;
  }
  // The remote tips come from the push itself, but ancestry is answered against
  // the local `origin/main`, so refresh it first and fail closed if that fails.
  if ((await git("fetch", "--quiet", "origin", "main")).code !== 0) {
    return refuse(
      "release-branch guard: could not fetch `origin main` to check release-branch integration. Refusing the push; restore network access or fetch manually and retry.",
    );
  }
  for (const ref of refs) {
    const verdict = evaluateReleaseBranchGuard({
      action,
      branch: ref.branch,
      // A branch that does not exist on the remote yet (all-zero tip) cannot
      // have been integrated, so creating it is allowed.
      integrated: ZERO_SHA.test(ref.remoteSha) ? false : await remoteTipIntegrated(ref),
    });
    if (!verdict.ok) {
      return refuse(verdict.reason);
    }
  }
  return 0;
};

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
