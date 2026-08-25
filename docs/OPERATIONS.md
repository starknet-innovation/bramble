---
layout: default
title: Production operations
permalink: /operations/
---

# Production operations

This is the public operational contract for MC Wallet. It covers the extension, the wallet-operated
Starknet gateway, releases, and support diagnostics. It never authorizes operators to request a
recovery phrase, private key, signing payload, address, transaction hash, calldata, origin, or raw
RPC body.

## Ownership and response targets

The maintainer approving a production release is its **release owner** and records their GitHub
handle in the release issue. A different security-sensitive CODEOWNER is the **incident deputy**.
The first responder becomes incident commander until they hand over explicitly in the incident
record.

| Severity | Example | Acknowledge | Mitigate or stop rollout | Update cadence |
| --- | --- | ---: | ---: | ---: |
| P0 | suspected key exposure, unauthorized signing, corrupt recovery, malicious release | 15 min | 60 min | 30 min |
| P1 | widespread inability to unlock, submit, restore, or reach healthy RPC | 30 min | 4 hours | 60 min |
| P2 | degraded lane with a safe fallback; isolated flow regression | 1 business day | 3 business days | daily |

For a security incident, use GitHub private vulnerability reporting and follow `SECURITY.md`. For
an availability incident, open a maintainer-visible incident record with start time, severity,
owner, affected release, user impact, decisions, and next update. Never paste a user's diagnostic
file into a public issue.

## Gateway monitoring

`.github/workflows/gateway-health.yml` probes the bundled wallet gateway and direct Foundation
fallback for Mainnet and Sepolia every 15 minutes. It sends only `starknet_chainId`, emits only the
network, endpoint class, outcome class, and latency, and fails on a non-success response, wrong
chain, rate limit, timeout, transport fault, or latency over five seconds.

Operator alerts must route failed workflow runs to the release owner and incident deputy. The
gateway operator's own dashboard must additionally alert on p50/p95/p99 latency, JSON-RPC error
class, upstream failover count, HTTP/gateway refusal rate, and rate-limit utilization. This
repository cannot configure the separately operated gateway dashboard; the release issue must link
to it before public rollout.

Run the same probe locally without account data:

```sh
bun run scripts/check-gateway-health.ts
```

## Privacy-safe diagnostics

Reliability counters are disabled by default. A user may enable them under **Settings → Appearance
& currency → Reliability diagnostics**. The service worker then keeps separate process-local
aggregate rows for Starknet JSON-RPC endpoints and the optional Starkscan explorer lane, using only
fixed service/endpoint classes, outcomes, and average latency. Disabling the setting clears both
sets of counters. No diagnostic is uploaded automatically.

**Download diagnostics** creates a JSON file containing build metadata, coarse wallet state
(network, locked/ready/vault booleans, and account count), plus distinct `rpc` and `explorer`
aggregate rows. Explorer traffic is never counted as RPC. Exact URLs, addresses, origins, hashes,
calldata, RPC methods, raw errors, bodies, secrets, device identities, and timestamps are
structurally absent. A support responder must ask the user to inspect the file and share it
voluntarily; support must never ask for any other wallet export.

## Incident procedure

1. Acknowledge, assign severity, release owner, deputy, and next-update time.
2. Stop a Chrome Web Store rollout or defer publication when the affected build is not yet at 100%.
3. Confirm the immutable release SHA, package checksum, current gateway probe, and failure class.
4. Reproduce with a fresh Chrome profile and only synthetic accounts. Do not import user material.
5. Prefer an operational mitigation (healthy upstream, lower rollout, disabled service) when it does
   not weaken signing, validation, privacy, or vault controls.
6. For code, branch `hotfix/<description>` from the affected release tag, make the smallest reviewed
   fix, bump both versions, and run the complete release validation in `RELEASING.md`.
7. Publish the higher version to trusted testers first. Promote only after the original reproduction
   and smoke suite pass. Forward-apply the fix to the active release branch.
8. Close with timeline, root cause, affected versions, evidence, follow-ups, and an explicit statement
   that no wallet secrets were collected.

The hotfix mechanics are executable and covered by
`tests/conformance/release-version-single-source.test.ts`; each quarterly drill runs that test plus
the package checksum and records the command output in a private incident-drill issue.

## Launch gates

- Gateway probes green for seven consecutive days and the operator dashboard/alert route linked.
- Latest full nightly, dependency audit, extension E2E, package checksum, and fresh-profile restore
  green on the exact release SHA.
- Chrome Web Store owner, required reviewer, privacy URL, listing, permissions declarations, test
  instructions, and verified-update key custody recorded privately.
- Trusted-tester cohort completes the UX protocol in `docs/UX_VALIDATION.md` with no open P0/P1.
- Krusty provenance and Ledger compatibility boundaries in the release checklist are closed.
- Public rollout starts only after the release owner and incident deputy sign the release issue.
