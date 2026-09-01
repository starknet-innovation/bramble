# Security Policy

MC Wallet is a browser-extension wallet that handles private keys, encrypted
vault state, and dapp permissions. We take security reports seriously and
appreciate responsible disclosure.

## Supported Versions

Only the latest released version receives security fixes. This project is under
active development and does not maintain long-lived release branches; report
issues against the current `main`.

## Scope

Security-relevant areas include, but are not limited to:

- The extension surface: background service worker, side panel, content script,
  and injected provider bridge (`window.starknet_bramble`).
- Cryptography and the encrypted vault: key handling, encrypted stores, schema
  validation, and unlock/session flows.
- The provider bridge and message handling between page, content script, and
  background (origin/type/capability validation).

Wallet cryptography is owned by Krusty KMS. Issues rooted in key derivation,
signing, or the KMS WASM boundary may be routed upstream to the Krusty KMS
project; we will coordinate disclosure where that applies.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue, pull request, or discussion for
security vulnerabilities. Public disclosure before a fix puts users' funds and
keys at risk.

Report privately through **GitHub's private vulnerability reporting**: open the
repository's **Security** tab and choose **"Report a vulnerability"**. This
opens a private advisory visible only to maintainers.

> Maintainers: enable private vulnerability reporting under
> **Settings → Code security and analysis → Private vulnerability reporting**
> so the link above is available to reporters.

<!-- Maintainers: add a security contact email here if preferred -->

When reporting, please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, a proof of concept, or affected code paths.
- Any suggested remediation, if known.

## What to Expect

- We will acknowledge your report after we have had a chance to review it.
- We will keep you informed as we investigate and work on a fix.
- We ask that you give us reasonable time to remediate before any public
  disclosure, and that you avoid accessing or modifying other users' data
  during your research.

We do not currently offer a paid bug bounty. We are grateful for good-faith
reports and are happy to credit reporters unless you prefer to remain anonymous.
