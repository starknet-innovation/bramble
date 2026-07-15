# Changelog

All notable changes to MC Wallet are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Sections are maintained on the active `release/vX.Y` branch during release prep
(`bun run changelog`) and consumed as the GitHub Release notes when the release
is cut. See DEVELOPMENT.md and RELEASING.md.

## [0.5.0] - Unreleased

Phase 5 (hardening, audit & public release — roadmap #83).

### Added
- Automated release-on-merge: promoting a `release/*` or `hotfix/*` branch to
  `main` now cuts the tagged GitHub Release automatically, with the version
  derived from the merged branch (issue #59, #60).

### Changed
- The release version is single-sourced from `package.json`; the tag, artifact,
  and changelog all derive from it and a gate fails the release on any drift
  (closes the gap that shipped `v0.4.0` as `mc-wallet-0.3.0.zip`).

## [0.4.0] - 2026-06-30

### Added
- First release under the roadmap-driven release-branch model (milestone `v0.4`,
  Phase 3 — table-stakes parity).

## [0.3.0] - 2026-05-19

### Added
- Baseline wallet shell established as the initial stable version on `main`.
