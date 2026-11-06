---
layout: default
title: Mainnet E2E in CI
permalink: /mainnet-e2e-ci/
---

# Mainnet E2E in CI

`.github/workflows/mainnet-e2e.yml` runs the live Starknet mainnet suites against
the active release branch. It is not part of pull-request CI, and it does not
run the offline Playwright suite. The offline suite still blackholes DNS.

Two runs never overlap. The concurrency group is `mainnet-e2e` and
`cancel-in-progress` is false, so a second run waits instead of abandoning a
transaction that already has a nonce.

## How the jobs split trust

The release commit is code that any writer to a `release/*` branch controls,
so the workflow never lets it run on the same runner as something it must not
reach.

| Job | Runner | Code | Secrets |
| --- | --- | --- | --- |
| `preflight` | hosted | `main` | `MAINNET_E2E_RPC_URL` (`mainnet-e2e-balance`) |
| `build` | CodeBuild | release commit | none |
| `execute` | CodeBuild | the `build` output | the hot-wallet key (`mainnet-e2e`) |
| `post` | hosted | `main` | `MAINNET_E2E_RPC_URL` (`mainnet-e2e-balance`) |
| `report` | hosted | none | issue write only |

- `build` installs dependencies, verifies the pinned upstreams, builds the
  extension, installs Chromium into the workspace, and uploads one tarball
  (one-day retention). It holds no secret.
- `execute` checks the tarball's SHA-256, unpacks it, and runs the tests. It
  never installs, builds, or checks out, so a dependency's install script
  never shares a runner with the key.
- `preflight` reads the balances before the run and passes them to `post` as
  job outputs. The code under test cannot rewrite that baseline.
- `preflight` also passes `rpc_sha256`, the SHA-256 of the RPC URL it
  validated, as a job output. See [One RPC endpoint](#one-rpc-endpoint).
- Test output is never printed. `execute` reports counts and verdicts from the
  workflow's own inline code (Playwright's JSON stats, fixed markers from the
  gasless script). Rerun locally to see the full output.

The release code in `execute` still runs with the key. That is the point of
the test, and why the [maintainer setup](#maintainer-setup) restricts who can
write a release branch and who approves a run.

## One RPC endpoint

`execute` uses exactly the RPC endpoint `preflight` validated, or it stops
before any test signs. Before the tests, its **Check the RPC matches
preflight** step:

- hashes its own `MAINNET_E2E_RPC_URL` and compares it with preflight's
  `rpc_sha256`. A missing hash or a different URL (for example, different
  values in `mainnet-e2e` and `mainnet-e2e-balance`) fails the run;
- applies preflight's rules again: HTTPS only, not
  `wallet.nodes.starknet.org` or `mainnet.nodes.starknet.org`, and
  `starknet_chainId` must answer mainnet. An endpoint that is down, redirects
  or answers another chain fails the run.

The gasless script applies the same rules again in CI (`requireCiMainnetRpc`
in `scripts/gasless-mainnet-rpc.ts`). In CI it never falls back to the
wallet's shared RPC or an sncast URL; local runs keep the fallback.

The URL is compared by hash and never printed or passed as an output.

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

## What runs

- `bun run test:mainnet` (gasless): one gasless USDC transaction on every run.
- `bun run test:e2e:mainnet` (Playwright): only in the STRK20 tier. Its only
  spec is the STRK20 lifecycle, which does not fit the standard cap. When it
  runs, zero executed tests fail the job.

## Maintainer setup

Do this once, in order. The workflow cannot create environments, rulesets or
secrets. **Do not fund the key until steps 1 to 3 are done.**

1. Restrict who can create and update `release/*` branches (a branch ruleset
   with restricted creation and updates, admins only or a release team). The
   environment's branch rule checks the workflow's ref (`main`), not the
   release commit the job runs.
2. Create the GitHub Environment `mainnet-e2e`:
   - deployment branches: **`main`** only;
   - **required reviewers** on, with **prevent self-review** on. Each run,
     including the 06:00 schedule, waits for an approval before the key is
     released.
3. Put the hot-wallet secrets in `mainnet-e2e` only. Confirm none of them
   exists as a repository or organization secret.
4. Create the GitHub Environment `mainnet-e2e-balance`: deployment branches
   **`main`** only, no reviewers. It holds only `MAINNET_E2E_RPC_URL`, which
   the balance checks use to read the account.
5. Set the repository variable `MAINNET_E2E_ADDRESS` to the hot-wallet
   address. An address is public on chain; keeping it out of secrets keeps
   job outputs and the issue readable.
6. Confirm the CodeBuild project starts a fresh build per job, with no shared
   cache, volume, or Docker layer cache that keeps files between runs.
7. Set the repository variable `MAINNET_E2E_CONFIGURED` to `true`.

Until that variable is `true`, the workflow exits green and starts no
self-hosted runner. Once it is `true`, any missing variable or secret fails
the run.

### Secrets

| Secret | Environment | Purpose |
| --- | --- | --- |
| `MAINNET_E2E_PRIVATE_KEY` | `mainnet-e2e` | The hot wallet's signing key |
| `MAINNET_E2E_RPC_URL` | `mainnet-e2e` and `mainnet-e2e-balance` | Dedicated HTTPS mainnet RPC. Not `wallet.nodes.starknet.org` or `mainnet.nodes.starknet.org`. Must be the same value in both environments |
| `MAINNET_E2E_DISCOVERY_URL` | `mainnet-e2e`, STRK20 tier only | STRK20 discovery service |
| `MAINNET_E2E_PROVER_URL` | `mainnet-e2e`, STRK20 tier only | STRK20 proving service |

`vars.MAINNET_E2E_STRK20=true` opts into the STRK20 lifecycle. Leave it unset
for the standard tier. **Keep the STRK20 tier off** until every STRK20 signing
path charges the per-send budget before signing (see [The real cap is the
balance](#the-real-cap-is-the-balance)).

### What `execute` exports

New specs should read the hot wallet from these variables, not from an sncast
file:

| Variable | Value |
| --- | --- |
| `BRAMBLE_MAINNET_E2E_CI` | `1` |
| `BRAMBLE_MAINNET_E2E_ENVIRONMENT` | `mainnet-e2e` |
| `BRAMBLE_MAINNET_E2E_ADDRESS` | `vars.MAINNET_E2E_ADDRESS` |
| `BRAMBLE_MAINNET_E2E_PRIVATE_KEY` | `MAINNET_E2E_PRIVATE_KEY` |
| `BRAMBLE_MAINNET_E2E_RPC_URL` | `MAINNET_E2E_RPC_URL` |
| `MAINNET_E2E_SPEND_TIER` | `standard` or `strk20` |
| `GASLESS_E2E_ADDRESS` / `GASLESS_E2E_PRIVATE_KEY` / `GASLESS_E2E_RPC_URL` | the same account |
| `GASLESS_E2E_NETWORK` | `mainnet` |

`scripts/mainnet-e2e-guard.ts` (`decideMainnetCi`) refuses generic `CI`
unless those Actions variables match this workflow. Call it from a new
mainnet spec so a pull-request job cannot run the spec by accident. A spec
that signs must charge each amount to `sendBudgetFor(process.env)`
(`scripts/mainnet-e2e-send-budget.ts`) before signing. Local runs, where `CI`
is unset, are unchanged.

## Hot wallet

Use a new account that signs gasless v2. The OpenZeppelin class and the
`sncast` commands are in [GASLESS_MAINNET.md](GASLESS_MAINNET.md). Deploy it,
then fund it from a separate account.

Put the key only in `MAINNET_E2E_PRIVATE_KEY`. Do not commit an accounts file,
`snfoundry.toml`, or a URL that contains an API key.

### The real cap is the balance

Anything holding the key can spend everything on the account, so the worst
case is what the account holds. Keep it near the minimum, and top it up only
from a separate, independently controlled process (a person or a service that
does not run in this repository's CI). Never automate top-ups from this
workflow.

Standard tier, fund about **0.1 STRK** and **0.1 USDC**:

- STRK minimum **0.05 STRK**, maximum **2 STRK**, per-run cap **0.2 STRK**
- USDC minimum **0.02 USDC**, maximum **5 USDC**, per-run cap **0.05 USDC**

The preflight refuses to start when a balance is outside that window. A
balance above the maximum means the account holds more than an unattended key
should; move the excess off.

Two checks bound a run's spend:

- Before each signature, the gasless script charges the reviewed fee to the
  run's budget. A token other than STRK or native USDC, or a fee that would
  take the run over its cap, is refused before signing.
- After the run, `post` compares the balances with the preflight baseline and
  fails when the delta exceeds the per-run cap, or when a balance ends above
  the maximum.

The minimum is a preflight rule only. A normal run spends, so the ending
balance may fall below the minimum; `post` does not fail for that. The next
preflight does, and asks for a top-up.

Both guard against a buggy test. Neither stops hostile code that holds the
key; only the balance does.

On 28 October 2026 one gasless mainnet transaction cost 5232 USDC base units,
about 0.005 USDC, and no STRK (`docs/GASLESS_FEES.md`). A standard run is
capped at 0.2 STRK and 0.05 USDC.

STRK20 tier, set `vars.MAINNET_E2E_STRK20=true`, add the discovery and prover
secrets, and fund about **25 STRK** (minimum **21 STRK**, maximum **30 STRK**,
per-run cap **22 STRK**). The lifecycle deposits 0.05 STRK. At the pool fee
documented in [STRK20_PRIVACY.md](STRK20_PRIVACY.md) the run spends about
12–16 STRK and leaves part of the deposit private. USDC limits stay on the
standard tier. After a normal STRK20 run the balance is below 21 STRK; that
passes `post` and the next preflight asks for a top-up.

**The STRK20 tier must stay off.** Leave `vars.MAINNET_E2E_STRK20` unset
until every STRK20 signing path, including the lifecycle spec, charges the
per-send budget before it signs. Today the lifecycle spec does not, so only
the post-run check and the balance would bound it.

## Rotate the key

1. Create and deploy a new account. Do not reuse the old key.
2. Update `vars.MAINNET_E2E_ADDRESS` and `MAINNET_E2E_PRIVATE_KEY`.
3. Fund the new account inside the window above.
4. Drain the old account.
5. Do not open a pull request, issue, or log line that contains the key.

The next run picks up the new secret. No workflow edit is required.

## Skip and failure

| State | Result |
| --- | --- |
| `MAINNET_E2E_CONFIGURED` is not `true` | Green skip. No runner, no secret read |
| Enabled, any variable or secret missing | Red. The missing names are listed, not the values |
| Balance below the minimum or above the maximum | Red, before any test, and a tracking issue |
| `execute`'s RPC differs from preflight's, is not dedicated HTTPS, is down, or is not mainnet | Red, before any test. No fallback |
| A send would exceed the per-run cap | Red, refused before signing |
| Playwright runs and executes no test | Red |
| A test fails, or the spend exceeds the cap | Red, with before/after/spent in the summary and the issue |
| A run ends below the minimum, inside the cap | Green. The next preflight asks for a top-up |
