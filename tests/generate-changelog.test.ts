/**
 * Unit tests for the pure CHANGELOG helpers (issue #60): commit parsing,
 * category grouping, deterministic section rendering, and idempotent insertion.
 * No git, no clock, no file I/O — the date and commit list are supplied.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  categoryFor,
  extractSection,
  groupCommits,
  hasSection,
  insertSection,
  main,
  parseCommitSubject,
  renderSection,
  stampSectionDate,
} from "../scripts/generate-changelog";

describe("parseCommitSubject", () => {
  test("parses type, scope, and description", () => {
    expect(parseCommitSubject("fix(nft): bound owner-check fan-out")).toEqual({
      type: "fix",
      scope: "nft",
      description: "bound owner-check fan-out",
      breaking: false,
    });
  });

  test("flags a breaking change", () => {
    expect(parseCommitSubject("feat(api)!: drop legacy endpoint")).toMatchObject({
      breaking: true,
      type: "feat",
    });
  });

  test("treats a non-conventional subject as other", () => {
    expect(parseCommitSubject("Consolidate account management")).toEqual({
      type: "other",
      scope: null,
      description: "Consolidate account management",
      breaking: false,
    });
  });

  test("drops merge commits", () => {
    expect(parseCommitSubject("Merge pull request #104 from x/release/v0.4")).toBeNull();
    expect(parseCommitSubject("Merge branch 'main'")).toBeNull();
    expect(parseCommitSubject("   ")).toBeNull();
  });

  test("degrades malformed conventional subjects to Other without crashing", () => {
    // A type with no description is not a usable conventional commit; keep the
    // raw subject under Other rather than emitting an empty bullet.
    expect(parseCommitSubject("feat:")).toEqual({
      type: "other",
      scope: null,
      description: "feat:",
      breaking: false,
    });
    expect(parseCommitSubject("feat(scope):")).toMatchObject({ type: "other" });
    // Trailing whitespace and a CRLF terminator are trimmed off the description.
    expect(parseCommitSubject("feat: add x\r")).toEqual({
      type: "feat",
      scope: null,
      description: "add x",
      breaking: false,
    });
    expect(parseCommitSubject("  chore(deps):   bump   ")).toEqual({
      type: "chore",
      scope: "deps",
      description: "bump",
      breaking: false,
    });
  });
});

describe("categoryFor", () => {
  test("maps conventional types to headings", () => {
    expect(categoryFor({ type: "feat", scope: null, description: "x", breaking: false })).toBe(
      "Added",
    );
    expect(categoryFor({ type: "perf", scope: null, description: "x", breaking: false })).toBe(
      "Performance",
    );
    expect(categoryFor({ type: "chore", scope: null, description: "x", breaking: false })).toBe(
      "Maintenance",
    );
  });

  test("breaking wins over the type mapping", () => {
    expect(categoryFor({ type: "fix", scope: null, description: "x", breaking: true })).toBe(
      "Breaking",
    );
  });
});

describe("groupCommits", () => {
  test("groups, orders, and de-duplicates", () => {
    const groups = groupCommits([
      "feat(sidepanel): add gallery",
      "fix: repair drawer",
      "fix: repair drawer",
      "Merge pull request #1 from x",
      "docs: clarify migration",
    ]);
    expect(groups.get("Added")).toEqual(["- **sidepanel:** add gallery"]);
    expect(groups.get("Fixed")).toEqual(["- repair drawer"]);
    expect(groups.get("Documentation")).toEqual(["- clarify migration"]);
  });
});

describe("renderSection", () => {
  test("renders a deterministic, category-ordered section", () => {
    const section = renderSection("0.5.0", "2026-07-15", [
      "fix(prices): flag partial fetches stale",
      "feat: automate release-on-merge",
    ]);
    expect(section).toBe(
      [
        "## [0.5.0] - 2026-07-15",
        "",
        "### Added",
        "",
        "- automate release-on-merge",
        "",
        "### Fixed",
        "",
        "- **prices:** flag partial fetches stale",
      ].join("\n"),
    );
  });

  test("never emits an empty section", () => {
    const section = renderSection("0.5.0", "2026-07-15", ["Merge pull request #1 from x"]);
    expect(section).toContain("No user-facing changes recorded");
  });
});

describe("hasSection / extractSection", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [0.5.0] - 2026-07-15",
    "",
    "### Added",
    "- thing",
    "",
    "## [0.4.0] - 2026-06-30",
    "",
    "### Added",
    "- older",
  ].join("\n");

  test("detects a documented version", () => {
    expect(hasSection(changelog, "0.5.0")).toBe(true);
    expect(hasSection(changelog, "0.9.0")).toBe(false);
  });

  test("extracts only the requested version's section", () => {
    const section = extractSection(changelog, "0.5.0");
    expect(section).toBe(["## [0.5.0] - 2026-07-15", "", "### Added", "- thing"].join("\n"));
    expect(extractSection(changelog, "0.9.0")).toBeNull();
  });
});

describe("insertSection", () => {
  const changelog = ["# Changelog", "", "## [0.4.0] - 2026-06-30", "", "### Added", "- older"].join(
    "\n",
  );

  test("inserts a new section above the newest existing version", () => {
    const next = insertSection(changelog, "## [0.5.0] - 2026-07-15\n\n### Added\n- new", "0.5.0");
    const idx5 = next.indexOf("[0.5.0]");
    const idx4 = next.indexOf("[0.4.0]");
    expect(idx5).toBeGreaterThan(-1);
    expect(idx5).toBeLessThan(idx4);
  });

  test("is idempotent when the version already exists", () => {
    const withFive = insertSection(changelog, "## [0.4.0] - x\n\n### Added\n- dup", "0.4.0");
    expect(withFive).toBe(changelog);
  });

  test("seeds from a header when there is no prior version", () => {
    const next = insertSection("# Changelog\n", "## [0.1.0] - 2026-01-01\n\n- first", "0.1.0");
    expect(next).toContain("# Changelog");
    expect(next).toContain("## [0.1.0]");
  });
});

describe("stampSectionDate", () => {
  test("stamps the release date over an Unreleased placeholder", () => {
    const stamped = stampSectionDate("## [0.5.0] - Unreleased\n\n### Added\n- thing", "2026-07-15");
    expect(stamped).toBe("## [0.5.0] - 2026-07-15\n\n### Added\n- thing");
  });

  test("stamps a heading that has no date at all", () => {
    expect(stampSectionDate("## [0.5.0]\n\n- thing", "2026-07-15")).toBe(
      "## [0.5.0] - 2026-07-15\n\n- thing",
    );
  });

  test("leaves an already-dated heading untouched", () => {
    const section = "## [0.4.0] - 2026-06-30\n\n- older";
    expect(stampSectionDate(section, "2026-07-15")).toBe(section);
  });

  test("does not stamp when the supplied date is itself a placeholder", () => {
    const section = "## [0.5.0] - Unreleased\n\n- thing";
    expect(stampSectionDate(section, "unreleased")).toBe(section);
  });
});

describe("main", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir !== null) {
      await rm(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  const scratchFile = async (name: string): Promise<string> => {
    dir = await mkdtemp(join(tmpdir(), "changelog-test-"));
    return join(dir, name);
  };

  const captureStdout = async (
    fn: () => Promise<number>,
  ): Promise<{ out: string; code: number }> => {
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await fn();
      return { out: chunks.join(""), code };
    } finally {
      process.stdout.write = original;
    }
  };

  test("notes mode prefers an existing section and stamps its pending date", async () => {
    const file = await scratchFile("CHANGELOG.md");
    await Bun.write(
      file,
      ["# Changelog", "", "## [0.5.0] - Unreleased", "", "### Added", "- curated line", ""].join(
        "\n",
      ),
    );
    const { out, code } = await captureStdout(() =>
      main({
        CHANGELOG_VERSION: "0.5.0",
        CHANGELOG_MODE: "notes",
        CHANGELOG_FILE: file,
        CHANGELOG_DATE: "2026-07-15",
        CHANGELOG_COMMITS: "feat: ignored because the curated section wins",
      }),
    );
    expect(code).toBe(0);
    expect(out).toContain("## [0.5.0] - 2026-07-15");
    expect(out).toContain("- curated line");
    expect(out).not.toContain("Unreleased");
    expect(out).not.toContain("ignored");
  });

  test("notes mode falls back to generating from commits when no section exists", async () => {
    const file = await scratchFile("CHANGELOG.md");
    const { out, code } = await captureStdout(() =>
      main({
        CHANGELOG_VERSION: "0.6.0",
        CHANGELOG_MODE: "notes",
        CHANGELOG_FILE: file,
        CHANGELOG_DATE: "2026-08-01",
        CHANGELOG_COMMITS: "feat(x): new thing\nMerge pull request #9 from y",
      }),
    );
    expect(code).toBe(0);
    expect(out).toContain("## [0.6.0] - 2026-08-01");
    expect(out).toContain("- **x:** new thing");
  });

  test("update mode inserts the section and is idempotent on a second run", async () => {
    const file = await scratchFile("CHANGELOG.md");
    const env = {
      CHANGELOG_VERSION: "0.6.0",
      CHANGELOG_MODE: "update",
      CHANGELOG_FILE: file,
      CHANGELOG_DATE: "2026-08-01",
      CHANGELOG_COMMITS: "fix: repair it",
    } as const;
    expect(await main(env)).toBe(0);
    const first = await readFile(file, "utf8");
    expect(first).toContain("# Changelog");
    expect(first).toContain("## [0.6.0] - 2026-08-01");
    expect(first).toContain("- repair it");
    expect(await main(env)).toBe(0);
    const second = await readFile(file, "utf8");
    expect(second).toBe(first);
  });

  test("rejects a missing version and an unknown mode", async () => {
    const file = await scratchFile("CHANGELOG.md");
    expect(await main({ CHANGELOG_MODE: "notes", CHANGELOG_FILE: file })).toBe(1);
    expect(
      await main({ CHANGELOG_VERSION: "0.6.0", CHANGELOG_MODE: "bogus", CHANGELOG_FILE: file }),
    ).toBe(1);
  });
});
