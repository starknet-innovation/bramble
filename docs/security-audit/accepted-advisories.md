---
layout: default
title: Accepted dependency advisories
permalink: /security-audit/accepted-advisories/
---

# Accepted dependency advisories

`bun run check:audit` fails the build on any **high** advisory. An advisory may be ignored only when
it cannot reach the shipped extension, no patched release exists, and it is listed here with a
re-check date and a tracking issue. Each ignore names one advisory ID; nothing is suppressed by
package or severity.

## Active

| Advisory | Package | Path | Why it is accepted | Re-check by | Tracking |
| --- | --- | --- | --- | --- | --- |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) (high) | `node-forge` <=1.4.0 | dev-only: `web-ext` → `@devicefarmer/adbkit` → `node-forge@1.4.0` | `web-ext` is the Firefox lint and packaging tool. `node-forge` is not bundled into the extension, the website or the terminal app. npm has no patched release yet (latest 1.4.0). | 2026-11-02 | #495 |

**To remove an entry:** update the lockfile to a patched release, drop its `--ignore` from
`package.json` and `scripts/config-standards-policy.ts`, and move the row to "Removed".

## Removed

None yet.
