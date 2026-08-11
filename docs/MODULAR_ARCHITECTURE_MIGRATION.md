---
layout: default
title: Modular architecture migration record
permalink: /modular-architecture-migration/
---

# Modular architecture migration record

This is the completed migration sequence behind the current
[modular architecture](../modular-architecture/).

## 1. Workspace substrate

- Added root Bun workspaces and shared strict compiler settings.
- Reused the custom standards toolchain to enforce package dependencies and exports.
- Aligned duplicated tool versions without changing extension runtime dependencies.
- Preserved build output and packaged behavior.

Acceptance: frozen install, existing checks, and extension package remain behaviorally compatible.

## 2. Foundation contracts

- Extracted core primitives and wallet models.
- Co-located protocol types with their runtime decoders.
- Derived dapp and approval classifications from the protocol registry.
- Moved UI Lab onto declared Wallet UI exports while Terminal remained a provider client.

Acceptance: provider request/response definitions have one wallet source and page-side bundles
contain only permitted foundation and application modules.

## 3. Platform boundaries

- Separated generic store primitives from feature records.
- Extracted vault and Krusty adapter boundaries.
- Reduced Starknet to generic chain behavior.
- Separated Ledger protocol/state from browser hardware transports.

Acceptance: store, vault, Starknet, and Ledger dependencies are acyclic; secret and vendor checks
remain green.

## 4. Feature ownership

- Extracted privacy, multisig, transactions, portfolio, permissions, and settings.
- Moved each feature's records, repositories, chain adapters, operations, and tests together.
- Kept privileged authorization and cross-feature orchestration in the background authority.

Acceptance: feature packages test independently and import neither Chrome nor presentation code.

## 5. Presentation and application roots

- Extracted UI Kit and Wallet UI.
- Replaced UI Lab implementation-path imports with the development-only `./lab` facade.
- Moved extension entrypoints, static pages, browser adapters, and build scripts into
  `apps/extension`.
- Grouped background, side-panel, Terminal, UI Lab, and package internals by named capability.

Acceptance: entrypoints compose explicit capabilities; bundle policy, Storybook, extension E2E,
and visual scenarios consume the same production UI package.

## 6. Compatibility cleanup

- Removed temporary old-path re-exports and legacy import allowances.
- Removed nested lockfiles and duplicated tool configuration.
- Added enforcement against loose implementation files at declared source roots.
- Updated architecture, engineering, audit, development, and release documentation.

Acceptance: full checks, build, Chromium E2E, extension packaging, checksum verification, and the
dependency graph pass from a fresh checkout.
