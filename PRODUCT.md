# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

MC Wallet serves people who manage Starknet accounts, assets, dApp requests, and hardware-wallet
signatures from Chrome. Its development and review surfaces also serve engineers, designers, and
product reviewers who need to inspect difficult wallet states without moving real funds or walking
through every preceding phase.

## Product Purpose

MC Wallet is a Chrome Manifest V3 Starknet wallet that keeps account management, transfers,
signatures, dApp approvals, tokens, NFTs, allowances, and multisig work available in the browser
side panel. Success means users can understand what the wallet is doing, verify sensitive actions,
and complete them without losing context or crossing account, origin, or signing boundaries.

## Positioning

The wallet combines a persistent side-panel interaction model with fail-closed Krusty KMS signing,
keyless Ledger accounts, explicit dApp capability grants, and decoded pre-sign reviews. Its UI
review environment renders the production wallet templates and bindings against deterministic
fixture-only scenarios rather than imitating them in a separate design prototype.

## Operating Context

The primary product runs as an unpacked or published Chrome extension. Reviewers work from local
builds, pull requests, Storybook scenarios, Chromatic review links, and Playwright traces. Mainnet
is the default network and moves real funds, so review fixtures must remain visibly synthetic and
must never depend on a real vault, device, secret, signer, or broadcast.

## Capabilities and Constraints

- Bun and strict TypeScript; the extension itself has no UI framework.
- Manifest V3 side panel, toolbar popup, dedicated Ledger browser surface, and injected Starknet
  provider.
- Krusty KMS is the only software signing and derivation boundary; Ledger accounts remain keyless.
- Extension messages, storage, account state, and origin grants are security boundaries.
- UI reads through permissioned runtime clients and renders with shared skin and scale tokens.
- Dev tooling must stay isolated from the extension bundle, use exact dependency versions, and be
  immediately exercised by checks.

## Brand Commitments

The product name is MC Wallet. Product language is direct, calm, and specific about state, risk,
and recovery. The established wallet interface uses a restrained neutral system with a single
cobalt action accent, explicit semantic success/danger colors, crisp hierarchy, and purposeful
motion with complete reduced-motion support.

## Evidence on Hand

- Product and architecture documentation in `README.md`, `CONTRIBUTING.md`, and `docs/`.
- Production side-panel templates and bindings in `src/sidepanel/`.
- Shared skin, scale, motion, and typography contracts in `src/ui/`.
- Deterministic fixtures and test harnesses in `tests/support/`.
- Extension integration coverage in `tests/e2e/`.

No customer claims, usage benchmarks, or safety guarantees beyond the implemented and tested
controls may be fabricated in product or review surfaces.

## Product Principles

- Make sensitive system status visible before, during, and after every action.
- Keep accounts, networks, origins, and signing capabilities partitioned by construction.
- Reuse production contracts in review tooling so visual feedback cannot drift into a mock product.
- Fail closed at security boundaries and degrade honestly at network or hardware boundaries.
- Make difficult states directly inspectable, replayable, and discussable.

## Accessibility & Inclusion

All wallet and review surfaces must support keyboard navigation, visible focus, semantic status and
error output, readable contrast, reduced motion, and layouts that remain usable at the real popup
and side-panel dimensions.
