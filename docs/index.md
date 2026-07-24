---
layout: default
title: MC Wallet documentation
permalink: /
---

# MC Wallet documentation

MC Wallet is a Starknet browser-extension wallet. These documents describe the extension's trust
boundaries, release controls, and security posture.

## Start here

- [Architecture and internals](architecture/) explains the runtime and data model.
- [Security audit](security-audit/) tracks the directory-by-directory review of the current
  released baseline.
- [Source package audit](security-audit/src-package-audit/) aggregates the completed review of all
  12 immediate packages under `src/`.
- [v0.6 release audit](security-audit/releases/v0.6/) records the Ledger and multisig PR reviews,
  remediations, validation evidence, and residual third-party boundaries.
- [v0.7 release assurance](security-audit/releases/v0.7/) records the NFT ownership, metadata,
  transfer-review, privacy, performance, and release-gate review.
- [Security policy](https://github.com/starknet-innovation/mc-wallet/blob/main/SECURITY.md) explains
  how to report a vulnerability privately.
- [Contributing](https://github.com/starknet-innovation/mc-wallet/blob/main/CONTRIBUTING.md) contains
  the binding engineering and security rules.

Security-sensitive exploit details are not published here before a fix is available. See the
[audit disclosure policy](security-audit/methodology/#disclosure-handling).
