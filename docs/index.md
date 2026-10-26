---
layout: default
title: Bramble documentation
permalink: /
---

# Bramble documentation

Bramble is a Starknet browser-extension wallet. These documents describe the extension's trust
boundaries, release controls, and security posture.

## Start here

- [User guide](user-guide/) is for people using the wallet: install, first run,
  creating/backing up/restoring a wallet, the main features, and a safety FAQ.
- [Start here for engineers](engineering/) is the contributor onboarding entry: a
  reading order plus the import-layer module map and the untrusted-message
  data-flow diagram.
- [UI Lab](https://effective-adventure-qwr464j.pages.github.io/) hosts deterministic Storybook
  scenarios for production wallet UI and Chromatic review. Its
  [runbook](https://github.com/starknet-innovation/bramble/tree/main/apps/ui-lab) covers local
  setup, testing, static builds, review controls, and safety boundaries.
- [Architecture and internals](architecture/) explains the runtime and data model.
- [Gasless fees](gasless-fees/) is the proposed design for paying gas in tokens other than STRK
  (issue #752), including the backend requirements.
- [Modular architecture](modular-architecture/) defines the package boundaries, typed invariants,
  target repository, migration sequence, and completion gates for the modular-monolith refactor.
- [Wallet store architecture](wallet-store/) maps every persistent and session store, account
  scoping, Chrome update migration, and optional Ledger viewing-key custody.
- [Production operations](operations/) defines gateway monitoring, privacy-safe support diagnostics,
  incident ownership, response targets, hotfix handling, and public-launch gates.
- [Observed UX validation](ux-validation/) defines the external task protocol and release evidence.
- [STRK20 privacy integration](strk20-privacy/) documents the pinned SDK, service contract,
  privileged data flow, failure boundaries, and deployment inputs.
- [Security audit](security-audit/) tracks the directory-by-directory review of the current
  released baseline.
- [Source package audit](security-audit/src-package-audit/) preserves the completed review of the
  pre-workspace source layout that formed the v0.9 audit baseline.
- [v0.6 release audit](security-audit/releases/v0.6/) records the Ledger and multisig PR reviews,
  remediations, validation evidence, and residual third-party boundaries.
- [v0.7 release assurance](security-audit/releases/v0.7/) records the NFT ownership, metadata,
  transfer-review, privacy, performance, and release-gate review.
- [Security policy](https://github.com/starknet-innovation/bramble/blob/main/SECURITY.md) explains
  how to report a vulnerability privately.
- [Contributing](https://github.com/starknet-innovation/bramble/blob/main/CONTRIBUTING.md) contains
  the binding engineering and security rules.

Security-sensitive exploit details are not published here before a fix is available. See the
[audit disclosure policy](security-audit/methodology/#disclosure-handling).
