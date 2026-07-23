---
layout: default
title: "Review 00: Root and manifest"
permalink: /security-audit/reviews/00-root-and-manifest/
---

# Review 00 — Repository root and extension manifest

| Field | Value |
| --- | --- |
| Status | Complete |
| Baseline | `8d91d78521deaada2b914b993b08c3c9d577b81e` (`v0.5.0`) |
| Reviewed | 2026-07-23 |

## Scope

- Root dependency and compiler configuration.
- `public/manifest.json` and `public/sidepanel.html`.
- Build/package entry points needed to prove what the manifest ships.
- Existing architecture and security documentation.

`.github/` and the rest of `scripts/` are reviewed separately because workflow authority, secret
handling, vendoring, and release behavior require their own pass.

## Confirmed controls

- Manifest V3 with a module service worker.
- Browser permissions are limited to `sidePanel` and `storage`.
- Host permissions are an explicit list of Starknet RPC, price, swap, phishing-feed, and local
  devnet origins.
- The content script and single web-accessible provider resource share an explicit HTTPS and local
  development match list.
- Extension scripts are packaged locally. The CSP permits packaged scripts and the
  `wasm-unsafe-eval` capability required by the bundled Krusty WASM module, without `unsafe-eval` or
  remote script origins.
- `public/sidepanel.html` contains one packaged module script and no inline event handlers.
- The manifest checker rejects unknown top-level capabilities and permission drift.
- Packaging rejects any file outside the nine-file runtime allowlist.
- Direct dependencies and development tools are exact-pinned; transitive packages carry integrity
  hashes in `bun.lock`.
- `bun audit --audit-level=high` reported no known vulnerabilities on 2026-07-23.
- The complete unit suite passed: 1,911 tests, 0 failures, 5,092 expectations.

## Findings

- [MCW-AUD-001](../../findings/#mcw-aud-001--biome-internal-panics-do-not-fail-the-lint-gate)
  — low-severity audit-assurance gap.
- [MCW-DOC-001](../../findings/#mcw-doc-001--raw-key-import-is-shipped-but-documented-as-absent)
  — resolved informational security-documentation drift.

No direct exploit was confirmed in this review.

## Baseline command notes

`bun run check` cannot be quoted as a clean pass in this checkout:

- The lint stage emits two Biome internal panics but returns success; this is MCW-AUD-001.
- Four tests that bind an ephemeral localhost server fail inside the restricted sandbox with
  `EADDRINUSE`; all four passed outside the sandbox, and the full outside-sandbox unit run passed.
- Pre-existing untracked `dist.zip` and `target/` developer artifacts trigger repository-wide file
  scanning. They were preserved, temporarily excluded from the baseline scan, and restored. They
  are not part of the audited commit.

The independent manifest, import-layer, dependency-cycle, KMS adapter, multisig artifact, standards,
dependency-audit, and unit-test evidence is retained above without representing the Biome stage as
clean.
