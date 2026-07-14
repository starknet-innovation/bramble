<!-- Thanks for contributing. This wallet handles private keys and extension permissions; treat every change as security-sensitive. -->
<!-- New here? Read DEVELOPMENT.md for the roadmap-driven release-branch workflow (where to branch, where to target). -->

## Summary

<!-- What does this change do, and why? -->

## Roadmap & release

<!-- Required for PRs into a release/vX.Y branch. See DEVELOPMENT.md. -->

- **Roadmap issue:** Closes #<!-- issue --> <!-- or "Refs #N" if it doesn't fully close it -->
- **Target release:** `release/v<!-- X.Y -->` <!-- this PR's base branch; working-branch PRs target the active release branch, NOT main -->
- **Acceptance criterion satisfied:** <!-- which release/milestone acceptance criterion this advances -->
- [ ] This change is **in scope** for the target release. Scope changes go to the milestone/roadmap first, not implicitly through this PR.

## Checks

- [ ] `bun run check` passes
- [ ] `bun run test:e2e` passes
- [ ] Tests are included for the behavior changed (storage/permissions/signing/migration changes require tests)
- [ ] No lint or type suppressions added (`@ts-ignore`, `biome-ignore`, etc.)
- [ ] All changed files stay under the 500-line cap

## Dependencies

<!--
CONTRIBUTING.md requires a justification for any dependency addition
(pinned exactly, used immediately). State the reason here, or write "none".
-->

none
