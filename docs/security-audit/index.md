---
layout: default
title: Security audit
permalink: /security-audit/
---

# MC Wallet security audit

This is the living, directory-by-directory security review of MC Wallet. The current baseline is
the released `main` commit below; pending pull requests are intentionally excluded until the
baseline review is complete.

| Field | Value |
| --- | --- |
| Baseline commit | `8d91d78521deaada2b914b993b08c3c9d577b81e` |
| Release | `v0.5.0` |
| Baseline date | 2026-07-16 |
| Audit started | 2026-07-23 |
| Current phase | Repository root, manifest, and all `src/` packages complete |
| Open product security findings | 0 |
| Open defense-in-depth and audit-assurance findings | 1 low |
| Open documentation findings | 0 |

## Audit documents

- [Methodology, severity, and disclosure handling](methodology/)
- [Threat model and trust boundaries](threat-model/)
- [Sanitized findings ledger](findings/)
- [Consolidated source package audit](src-package-audit/)
- [Directory review log](reviews/)

## Review sequence

| Order | Area | Security focus | Status |
| --- | --- | --- | --- |
| 00 | Repository root + `public/manifest.json` | Dependencies, compiler policy, permissions, CSP, packaged surface | Complete |
| 01 | `.github/` | CI trust, action pins, permissions, release and secret handling | Pending |
| 02 | `scripts/` | Build integrity, vendoring, packaging, release automation | Pending |
| 03 | `src/content/` | Page-to-extension isolation and message authenticity | Complete |
| 04 | `src/provider/` | Injected provider API, request/response validation | Complete |
| 05 | `src/background/` | Privileged routing, origin/capability gates, approvals, sessions | Complete |
| 06 | `src/popup/` | Privileged response parsing and HTML boundaries | Complete |
| 07 | `src/sidepanel/` | Secret lifetime, DOM sinks, transaction review integrity | Complete |
| 08 | `src/storage/` | Encryption, schema validation, migrations, permissions | Complete |
| 09 | `src/crypto/` | Krusty WASM trust boundary and fail-closed behavior | Complete |
| 10 | `src/wallet/` | Account derivation, imported keys, signing-key selection | Complete |
| 11 | `src/starknet/` | RPC trust, calldata/fee validation, token and protocol adapters | Complete |
| 12 | `src/security/` | Blocklist/feed parsing, normalization, fail-safe behavior | Complete |
| 13 | `src/shared/` + `src/ui/` | Shared parsers, output encoding, safe primitives | Complete |
| 14 | `contracts/` | Multisig source, compiler pin, class-hash reproducibility | Pending |
| 15 | `apps/terminal/` | Separate web-app/provider attack surface | Pending |
| 16 | `tests/` + `examples/` | Negative assurance, conformance coverage, unsafe examples | Pending |

The `src/` rows are aggregated into the
[source package audit](src-package-audit/). Each completed review links evidence to the exact
baseline commit. Pull-request review starts only after this table reaches the intended baseline
boundary.
