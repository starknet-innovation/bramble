---
layout: default
title: Audit methodology
permalink: /security-audit/methodology/
---

# Audit methodology

## Scope

The baseline review covers tracked source, configuration, contracts, build inputs, tests, and
release automation at commit `8d91d78521deaada2b914b993b08c3c9d577b81e` (`v0.5.0`). Generated
artifacts, local developer files, external RPC implementations, browser internals, and the upstream
Krusty KMS and Starknet Privacy SDK implementations are out of source-review scope. Their pinned
source/artifact integrity and wallet integration boundaries remain in scope.

Follow-on pull requests are reviewed after the baseline. Each PR is assessed against both its base
branch and the trust-boundary assumptions established here. The v0.6 Ledger and multisig review
uses runtime commit `cf1b174a8297264141b0449b129c11c7ad1d44d0`; release-only metadata changes do
not alter that reviewed runtime boundary.

## Approach

The audit combines:

1. Attack-surface and trust-boundary mapping.
2. Manual review of every tracked directory, with untrusted inputs followed to privileged effects.
3. Negative-path review for malformed messages, origin confusion, replay, approval bypass, secret
   exposure, unsafe rendering, and fail-open behavior.
4. Dependency, compiler, lint, import-layer, cycle, manifest, KMS-pin, multisig-pin, privacy-SDK
   pin, unit, build, package, and browser E2E checks where applicable.
5. Package-content comparison against the declared runtime allowlist.
6. Separate review of CI/release authority and secret handling.

The extension-specific baseline follows Chrome's guidance to keep executable code packaged,
minimize permissions, and expose only necessary web-accessible resources:

- [Improve extension security](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
- [Content Security Policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Web-accessible resources](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)
- [Protect user privacy](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy)

OWASP's entry-point enumeration guidance is used as the general testing frame:
[WSTG-INFO-06](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/01-Information_Gathering/06-Identify_Application_Entry_Points).

Passing automation is supporting evidence, not proof of absence.

## Severity

| Severity | Meaning |
| --- | --- |
| Critical | Direct, practical compromise of keys or arbitrary unauthorized transactions at scale |
| High | Practical secret disclosure, signing/approval bypass, or privileged code execution |
| Medium | Exploitable trust-boundary failure with meaningful but constrained impact |
| Low | Defense-in-depth or audit-assurance weakness without a demonstrated exploit path |
| Informational | Documentation, maintainability, or hardening issue with no direct security impact |

Every finding records evidence, impact, recommendation, status, and retest criteria. Unconfirmed
hypotheses remain review notes rather than findings.

## Disclosure handling

This site is intended to be public. Do not commit proof-of-concept exploit code, live secret
material, or enough detail to exploit an unremediated vulnerability.

For a suspected medium-or-higher issue:

1. Create a private GitHub Security Advisory.
2. Keep reproduction details and remediation work in the private advisory or a private fork.
3. Add only a sanitized identifier and status to the public ledger.
4. Publish technical detail after a fixed release is available and maintainers approve disclosure.

Low-risk assurance and documentation findings may be recorded directly when they do not create a
usable attack path.
