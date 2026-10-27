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

None.

**To remove an entry:** update the lockfile to a patched release, drop its `--ignore` from
`package.json` and `scripts/config-standards-policy.ts`, and move the row to "Removed".

## Temporary overrides

These are not ignores. `check:audit` still reports them if the pin slips. Each one is a root
`overrides` entry because a parent pins a vulnerable release exactly and a patched package
already exists.

| Package | Override | Why it is temporary | Drop when |
| --- | --- | --- | --- |
| `undici` | `7.30.1` | `wrangler`'s `miniflare` pins `undici` exactly at 7.29.1, inside [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c) (`>= 7.18.0, < 7.30.1`). 7.30.1 is the first patched 7.x release. One root pin also replaces the already-patched `undici@8.12.2` that `jsdom` requests (`^8.10.2`); 8.x would move `miniflare` off the 7.x line. | A `miniflare` release no longer pins `undici` 7.29.1. Then delete the override from `package.json` and `scripts/check-config-standards.ts`. |

## Removed

| Advisory | Package | Path | Why it is accepted | Re-check by | Tracking | Status |
| --- | --- | --- | --- | --- | --- | --- |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) (high) | `node-forge` <=1.4.0 | dev-only: `web-ext` → `@devicefarmer/adbkit` → `node-forge@1.4.0` | `web-ext` is the Firefox lint and packaging tool. `node-forge` is not bundled into the extension, the website or the terminal app. npm has no patched release yet (latest 1.4.0). | 2026-11-02 | #495 | Removed 2026-10-27: the lockfile resolves `node-forge@1.4.2` (patched, published 2026-10-27) and the `--ignore` is gone. |
