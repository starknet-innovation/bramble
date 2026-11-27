<!-- Thanks for contributing. This wallet handles private keys and extension permissions; treat every change as security-sensitive. -->
<!-- New here? Read DEVELOPMENT.md: branch from main, keep the PR small, target main, squash-merge. -->

## Summary

<!-- What does this change do, and why? -->

## Issue & scope

- **Issue:** Closes #<!-- issue --> <!-- or "Refs #N" if it doesn't fully close it -->
- [ ] This change is **in scope** for the linked issue. New scope goes to a new issue, not into this PR.
- [ ] Safe to release as soon as it merges: unfinished user-facing work is unwired or behind a feature flag (or this PR has none).
- [ ] If this touches signing, the vault, the background, the provider, privacy, or workflows, a review was requested before merge.

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
