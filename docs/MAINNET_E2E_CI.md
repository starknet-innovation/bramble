---
layout: default
title: Mainnet E2E in CI
permalink: /mainnet-e2e-ci/
---

# Mainnet E2E in CI

`.github/workflows/mainnet-e2e.yml` runs the live Starknet mainnet suites against
the active release branch. It is not part of pull-request CI, and it does not
run the offline Playwright suite. The offline suite still blackholes DNS.

The workflow runs whatever `playwright.mainnet.config.ts` matches
(`bun run test:e2e:mainnet`) and then `bun run test:mainnet`. New
`tests/mainnet/*.mainnet.ts` specs are picked up with no workflow edit.
Traces, screenshots, and video stay off. The job uploads no artifacts.

Two runs never overlap. The concurrency group is `mainnet-e2e` and
`cancel-in-progress` is false, so a second run waits instead of abandoning a
transaction that already has a nonce.

## When it runs

- Schedule: 06:00 UTC, three hours after nightly's 03:00 UTC run.
- Manual: Actions → **Mainnet E2E** → **Run workflow**. Choose the workflow
  file on **`main`**. An optional input overrides the release branch
  (`release/v0.10.9`). A blank input resolves the branch the same way nightly
  does: `vars.ACTIVE_RELEASE_BRANCH`, otherwise the highest `release/vX.Y` or
  `release/vX.Y.Z`.

GitHub schedules a workflow only from the default branch. Manual dispatch of
any other copy is rejected. Until this file is on `main`, the schedule does
not fire.

The job is not a required check for merging. A failure opens or updates one
issue titled `Mainnet E2E: release/vX.Y.Z — failing checks`.

## Maintainer setup

Do this once, in order. The workflow cannot create the environment or the
secrets.

1. Create a GitHub Environment named `mainnet-e2e`.
2. Limit its deployment branches to **`main`**. The workflow file runs from
   `main` and then checks out the release commit. Required reviewers also
   pause the 06:00 run until someone approves it; leave reviewers off if the
   schedule should run unattended.
3. Add the secrets below.
4. Set the repository variable `MAINNET_E2E_CONFIGURED` to `true`.

Until that variable is `true`, the workflow exits green and does not start
the self-hosted runner. If the variable is set and every hot-wallet secret is
still empty, the runner starts, prints a skip, and exits green. A partial
set fails the run.

### Secrets (`mainnet-e2e`)

| Secret | Required | Purpose |
| --- | --- | --- |
| `MAINNET_E2E_ADDRESS` | yes | Deployed hot-wallet address |
| `MAINNET_E2E_PRIVATE_KEY` | yes | That account's signing key |
| `MAINNET_E2E_RPC_URL` | yes | Dedicated HTTPS mainnet RPC. Not `wallet.nodes.starknet.org` or `mainnet.nodes.starknet.org` |
| `MAINNET_E2E_DISCOVERY_URL` | STRK20 tier only | STRK20 discovery service |
| `MAINNET_E2E_PROVER_URL` | STRK20 tier only | STRK20 proving service |

`vars.MAINNET_E2E_STRK20=true` opts into the STRK20 lifecycle. Leave it unset
for the standard tier. The lifecycle's pool fee does not fit the standard cap.

### What the job exports

New specs should read the hot wallet from these variables, not from an sncast
file:

| Variable | Value |
| --- | --- |
| `BRAMBLE_MAINNET_E2E_CI` | `1` |
| `BRAMBLE_MAINNET_E2E_ENVIRONMENT` | `mainnet-e2e` |
| `BRAMBLE_MAINNET_E2E_ADDRESS` | `MAINNET_E2E_ADDRESS` |
| `BRAMBLE_MAINNET_E2E_PRIVATE_KEY` | `MAINNET_E2E_PRIVATE_KEY` |
| `BRAMBLE_MAINNET_E2E_RPC_URL` | `MAINNET_E2E_RPC_URL` |
| `GASLESS_E2E_ADDRESS` / `GASLESS_E2E_PRIVATE_KEY` / `GASLESS_E2E_RPC_URL` | the same account |
| `GASLESS_E2E_NETWORK` | `mainnet` |

`scripts/mainnet-e2e-guard.ts` (`decideMainnetCi`) refuses generic `CI`
unless those Actions variables match this workflow. Call it from a new
mainnet spec so a pull-request job cannot run the spec by accident. Local
runs, where `CI` is unset, are unchanged.

## Hot wallet

Use a new account that signs gasless v2. The OpenZeppelin class and the
`sncast` commands are in [GASLESS_MAINNET.md](GASLESS_MAINNET.md). Deploy it,
then fund it from a separate account.

Put the key only in `MAINNET_E2E_PRIVATE_KEY`. Do not commit an accounts file,
`snfoundry.toml`, or a URL that contains an API key.

Standard tier, fund about **0.5 STRK** and **1 USDC**:

- STRK minimum **0.05 STRK**, maximum **2 STRK**, per-run cap **0.2 STRK**
- USDC minimum **0.02 USDC**, maximum **5 USDC**, per-run cap **0.05 USDC**

The preflight refuses to start when a balance is outside that window. A
balance above the maximum means the account holds more than an unattended key
should; move the excess off. The post-run step fails when the balance delta
exceeds the per-run cap, and the job summary records before, after, and spent
for both tokens.

On 28 October 2026 one gasless mainnet transaction cost 5232 USDC base units,
about 0.005 USDC, and no STRK (`docs/GASLESS_FEES.md`). A standard run is
capped at 0.2 STRK and 0.05 USDC, which covers that fee plus a second gasless
call and ordinary invoke fees. Specs that transfer STRK or USDC count the
transfer against the same cap. The dollar cost is the token price times at
most that cap. The most a leaked key can take is the maximum still on the
account: 2 STRK and 5 USDC.

STRK20 tier, set `vars.MAINNET_E2E_STRK20=true`, add the discovery and prover
secrets, and fund about **25 STRK** (minimum **21 STRK**, maximum **30 STRK**,
per-run cap **22 STRK**). The lifecycle deposits 0.05 STRK. At the pool fee
documented in [STRK20_PRIVACY.md](STRK20_PRIVACY.md) the run spends about
12–16 STRK and leaves part of the deposit private. USDC limits stay on the
standard tier.

## Rotate the key

1. Create and deploy a new account. Do not reuse the old key.
2. Update `MAINNET_E2E_ADDRESS` and `MAINNET_E2E_PRIVATE_KEY`.
3. Fund the new account inside the window above.
4. Drain the old account.
5. Do not open a pull request, issue, or log line that contains the key.

The next run picks up the new secret. No workflow edit is required.

## Skip and failure

| State | Result |
| --- | --- |
| `MAINNET_E2E_CONFIGURED` is not `true` | Green skip. No runner, no secret read |
| Variable set, all three hot-wallet secrets empty | Green skip after a notice |
| Some secrets set and some missing | Red. The missing names are listed, not the values |
| Balance below the minimum or above the maximum | Red, before any test, and a tracking issue |
| A test fails, or the spend exceeds the cap | Red, with before/after/spent in the summary and the issue |
