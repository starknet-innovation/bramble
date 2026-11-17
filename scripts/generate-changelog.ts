/**
 * Deterministic CHANGELOG generation for the release pipeline (issue #60).
 *
 * A release section is built from the Conventional-Commit subjects in the range
 * since the previous tag, grouped into Keep-a-Changelog headings. The pure
 * functions take their commit list and date as arguments — no `git`, no clock —
 * so the same inputs always render the same section and can be unit tested
 * offline. Only `main()` reads/writes `CHANGELOG.md` and reads the commit range
 * and date the release workflow passes through the environment.
 *
 * Two modes:
 *   - `notes`  — print the section for a version, preferring an existing
 *                `CHANGELOG.md` entry and falling back to generating one from
 *                the commit range (used for the GitHub Release body).
 *   - `update` — insert the generated section into `CHANGELOG.md` if it is not
 *                already present (idempotent), then write the file back.
 */
import { readFile, writeFile } from "node:fs/promises";
import { escapeRegExp } from "./regexp";

/** A commit subject parsed into its Conventional-Commit parts. */
export interface ParsedCommit {
  readonly type: string;
  readonly scope: string | null;
  readonly description: string;
  readonly breaking: boolean;
}

/** The ordered Keep-a-Changelog headings a section can contain. */
export const CHANGELOG_CATEGORIES = [
  "Breaking",
  "Added",
  "Changed",
  "Fixed",
  "Performance",
  "Documentation",
  "Maintenance",
  "Other",
] as const;

/** A Keep-a-Changelog heading. */
export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

/** The file header emitted when a `CHANGELOG.md` is created from scratch. */
export const CHANGELOG_HEADER = [
  "# Changelog",
  "",
  "All notable changes to Bramble are documented here. The format follows",
  "[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project",
  "adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).",
  "",
].join("\n");

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const MERGE = /^Merge (?:pull request|branch|remote-tracking)/i;
const TYPE_CATEGORY: Readonly<Record<string, ChangelogCategory>> = {
  feat: "Added",
  fix: "Fixed",
  perf: "Performance",
  refactor: "Changed",
  revert: "Changed",
  docs: "Documentation",
  build: "Maintenance",
  chore: "Maintenance",
  ci: "Maintenance",
  style: "Maintenance",
  test: "Maintenance",
};

/** Parses a commit subject; returns `null` for merge commits, which never appear in the log. */
export const parseCommitSubject = (subject: string): ParsedCommit | null => {
  const trimmed = subject.trim();
  if (trimmed === "" || MERGE.test(trimmed)) {
    return null;
  }
  const match = CONVENTIONAL.exec(trimmed);
  if (!match) {
    return { type: "other", scope: null, description: trimmed, breaking: false };
  }
  return {
    type: (match[1] ?? "other").toLowerCase(),
    scope: match[2] ?? null,
    description: (match[4] ?? "").trim(),
    breaking: match[3] === "!",
  };
};

/** The Keep-a-Changelog heading a parsed commit belongs under. */
export const categoryFor = (commit: ParsedCommit): ChangelogCategory => {
  if (commit.breaking) {
    return "Breaking";
  }
  return TYPE_CATEGORY[commit.type] ?? "Other";
};

const bullet = (commit: ParsedCommit): string =>
  commit.scope ? `- **${commit.scope}:** ${commit.description}` : `- ${commit.description}`;

/**
 * Groups commit subjects into ordered Keep-a-Changelog categories, dropping
 * merge commits and de-duplicating identical bullets (squash-merges repeat the
 * PR subject as a merge and a commit).
 */
export const groupCommits = (subjects: readonly string[]): Map<ChangelogCategory, string[]> => {
  const groups = new Map<ChangelogCategory, string[]>();
  for (const subject of subjects) {
    const commit = parseCommitSubject(subject);
    if (!commit) {
      continue;
    }
    const category = categoryFor(commit);
    const line = bullet(commit);
    const existing = groups.get(category) ?? [];
    if (!existing.includes(line)) {
      existing.push(line);
      groups.set(category, existing);
    }
  }
  return groups;
};

/**
 * Renders a Keep-a-Changelog section for a version. The date is supplied by the
 * caller (never read from the clock here) so rendering stays deterministic. When
 * no commit produces an entry, a single explanatory bullet is emitted so the
 * section is never empty.
 */
export const renderSection = (
  version: string,
  date: string,
  subjects: readonly string[],
): string => {
  const groups = groupCommits(subjects);
  const lines = [`## [${version}] - ${date}`, ""];
  let any = false;
  for (const category of CHANGELOG_CATEGORIES) {
    const entries = groups.get(category);
    if (!entries || entries.length === 0) {
      continue;
    }
    any = true;
    lines.push(`### ${category}`, "", ...entries, "");
  }
  if (!any) {
    lines.push("- No user-facing changes recorded for this release.", "");
  }
  return lines.join("\n").trimEnd();
};

const sectionPattern = (version: string): RegExp =>
  new RegExp(`^## \\[?${escapeRegExp(version)}\\]?(?:\\s|$)`);

/** Whether a `CHANGELOG.md` body already documents a version. */
export const hasSection = (changelog: string, version: string): boolean =>
  changelog.split("\n").some((line) => sectionPattern(version).test(line));

/**
 * A heading date that is not yet finalized. A section curated on the release
 * branch carries `- Unreleased` (or `- TBD`/`- TODO`, or nothing) until the
 * release is cut; the real date is only known at cut time.
 */
const PLACEHOLDER_DATE = /^(?:unreleased|tbd|todo)?$/i;

/**
 * Stamps the release date onto a section heading whose date is still a
 * placeholder (`## [0.5.0] - Unreleased` -> `## [0.5.0] - 2026-07-15`). A
 * heading that already carries a real date is left untouched, so a
 * deliberately dated section is never rewritten. Used for release notes so the
 * curated section is reused verbatim except for the pending date.
 */
export const stampSectionDate = (section: string, date: string): string => {
  if (PLACEHOLDER_DATE.test(date.trim())) {
    return section;
  }
  const newlineAt = section.indexOf("\n");
  const heading = newlineAt === -1 ? section : section.slice(0, newlineAt);
  const rest = newlineAt === -1 ? "" : section.slice(newlineAt);
  const match = /^(##\s*\[?[^\]\n]+?\]?)\s*(?:-\s*(.*?))?\s*$/.exec(heading);
  if (!match) {
    return section;
  }
  const currentDate = (match[2] ?? "").trim();
  if (!PLACEHOLDER_DATE.test(currentDate)) {
    return section;
  }
  return `${match[1] ?? heading} - ${date}${rest}`;
};

/** Extracts the section body for a version (heading included), or `null` if absent. */
export const extractSection = (changelog: string, version: string): string | null => {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => sectionPattern(version).test(line));
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const nextHeading = rest.findIndex((line) => /^## /.test(line));
  const end = nextHeading === -1 ? lines.length : start + 1 + nextHeading;
  return lines.slice(start, end).join("\n").trimEnd();
};

/**
 * Inserts a section above the first existing version heading (or after the
 * header when there is none). Idempotent: if the version is already documented
 * the changelog is returned unchanged.
 */
export const insertSection = (changelog: string, section: string, version: string): string => {
  if (hasSection(changelog, version)) {
    return changelog;
  }
  const body = changelog.trimEnd();
  const lines = body.split("\n");
  const firstVersion = lines.findIndex((line) => /^## \[?\d+\.\d+\.\d+/.test(line));
  if (firstVersion === -1) {
    const base = body === "" ? CHANGELOG_HEADER.trimEnd() : body;
    return `${base}\n\n${section}\n`;
  }
  const before = lines.slice(0, firstVersion).join("\n").trimEnd();
  const after = lines.slice(firstVersion).join("\n");
  return `${before}\n\n${section}\n\n${after}\n`;
};

const splitSubjects = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/**
 * CLI entrypoint. `CHANGELOG_MODE` selects `notes` (print the section for
 * `CHANGELOG_VERSION`, preferring an existing entry) or `update` (insert the
 * generated section into `CHANGELOG_FILE`). `CHANGELOG_COMMITS` is the newline-
 * separated commit subjects for the range, and `CHANGELOG_DATE` is the release
 * date. Returns the process exit code.
 */
export const main = async (
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> => {
  const version = env["CHANGELOG_VERSION"];
  if (version === undefined || version === "") {
    console.error("generate-changelog: CHANGELOG_VERSION is required");
    return 1;
  }
  const mode = env["CHANGELOG_MODE"] ?? "notes";
  const file = env["CHANGELOG_FILE"] ?? "CHANGELOG.md";
  const date = env["CHANGELOG_DATE"] ?? "unreleased";
  const subjects = splitSubjects(env["CHANGELOG_COMMITS"]);
  const existing = await readFile(file, "utf8").catch(() => "");

  if (mode === "notes") {
    const fromFile = existing === "" ? null : extractSection(existing, version);
    const section =
      fromFile !== null ? stampSectionDate(fromFile, date) : renderSection(version, date, subjects);
    process.stdout.write(`${section}\n`);
    return 0;
  }

  if (mode === "update") {
    const alreadyPresent = hasSection(existing, version);
    const section = renderSection(version, date, subjects);
    const base = existing === "" ? `${CHANGELOG_HEADER}\n` : existing;
    const next = insertSection(base, section, version);
    await writeFile(file, next.endsWith("\n") ? next : `${next}\n`);
    console.log(
      alreadyPresent
        ? `generate-changelog: ${file} already documents ${version}; left unchanged`
        : `generate-changelog: inserted ${version} into ${file}`,
    );
    return 0;
  }

  console.error(`generate-changelog: unknown CHANGELOG_MODE ${JSON.stringify(mode)}`);
  return 1;
};

if (import.meta.main) {
  process.exit(await main());
}
