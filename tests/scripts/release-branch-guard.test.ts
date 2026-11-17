/**
 * Regression tests for the local release-branch immutability guard (issue #302).
 *
 * `release/v0.10` accepted #279/#284 after it was already integrated into
 * `main`, orphaning those changes. The cases below are the guard's contract:
 * an active release branch stays writable, an integrated one refuses commits
 * and pushes (the push arm judging the REMOTE tip, so the first accidental
 * commit is still caught), unknown ancestry fails closed, and non-release
 * branches are never touched.
 */
import { describe, expect, test } from "bun:test";
import {
  evaluateReleaseBranchGuard,
  nextPatchBranch,
  parsePrePushRefs,
} from "../../scripts/release-branch-guard";

describe("release-branch guard policy", () => {
  test("allows commits on an active release branch", () => {
    expect(
      evaluateReleaseBranchGuard({ action: "commit", branch: "release/v0.11", integrated: false }),
    ).toEqual({ ok: true });
  });

  test("rejects a commit on an integrated release branch", () => {
    const verdict = evaluateReleaseBranchGuard({
      action: "commit",
      branch: "release/v0.10",
      integrated: true,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("release/v0.10 is already integrated into main");
      expect(verdict.reason).toContain("release/v0.10.1");
    }
  });

  test("rejects a push whose remote release tip is integrated, even with local commits", () => {
    const verdict = evaluateReleaseBranchGuard({
      action: "push",
      branch: "release/v0.10.1",
      integrated: true,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("a push here would orphan the change");
      expect(verdict.reason).toContain("release/v0.10.2");
    }
  });

  test("fails closed when ancestry cannot be determined", () => {
    const verdict = evaluateReleaseBranchGuard({
      action: "push",
      branch: "release/v0.10",
      integrated: null,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("git fetch origin main release/v0.10");
    }
  });

  test("leaves non-release branches alone, integrated or not", () => {
    for (const branch of ["main", "fix/302-release-branch-immutability", "hotfix/panic"]) {
      for (const integrated of [true, false, null]) {
        expect(evaluateReleaseBranchGuard({ action: "commit", branch, integrated })).toEqual({
          ok: true,
        });
      }
    }
  });
});

describe("parsePrePushRefs", () => {
  test("reads the branch and remote tip of each pushed head ref", () => {
    expect(
      parsePrePushRefs(
        "refs/heads/release/v0.10 aaa refs/heads/release/v0.10 bbb\n" +
          "refs/tags/v0.10.0 ccc refs/tags/v0.10.0 ddd\n",
      ),
    ).toEqual([{ branch: "release/v0.10", remoteSha: "bbb" }]);
  });

  test("ignores blank input", () => {
    expect(parsePrePushRefs("\n")).toEqual([]);
  });
});

describe("nextPatchBranch", () => {
  test("advances the patch component", () => {
    expect(nextPatchBranch("release/v0.10")).toBe("release/v0.10.1");
    expect(nextPatchBranch("release/v0.10.1")).toBe("release/v0.10.2");
  });
});
