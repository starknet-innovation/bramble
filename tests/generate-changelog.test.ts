/**
 * Unit tests for the pure CHANGELOG helpers (issue #60): commit parsing,
 * category grouping, deterministic section rendering, and idempotent insertion.
 * No git, no clock, no file I/O — the date and commit list are supplied.
 */
import { describe, expect, test } from "bun:test";
import {
  categoryFor,
  extractSection,
  groupCommits,
  hasSection,
  insertSection,
  parseCommitSubject,
  renderSection,
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
