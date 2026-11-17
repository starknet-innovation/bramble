---
layout: default
title: Observed UX validation
permalink: /ux-validation/
---

# Observed UX validation

Use this protocol with reviewers who do not work on Bramble. The UI Lab contains synthetic
fixtures only; never enter a real recovery phrase, private key, address, or transaction payload.
Serve the extracted static build over HTTP rather than opening `index.html` directly:

```sh
python3 -m http.server 8080 --directory bramble-ui-lab/storybook-static
```

Open `http://localhost:8080`, choose **Wallet journeys**, and keep the event log visible. The
observer may explain the fixture boundary and task goal, but must not name the next control unless
the participant is blocked. Record the first attempt; do not teach and restart it.

## Participant tasks

Run each task with at least one reviewer outside the team. Use **Play**, **Step**, and **Replay** to
move between deterministic checkpoints when the fixture cannot perform a real network or device
effect.

| Task | Starting area | Give the participant this goal | Completion evidence |
| --- | --- | --- | --- |
| Create and restore | Full-screen onboarding | “Create an OpenZeppelin wallet, then show how you would restore an Argent wallet and choose a discovered account.” | Correct contract choices, recovery scan understood, selected account confirmed. |
| Fund and deploy | Home → undeployed; Argent multisig | “Fund this undeployed account from another wallet, then deploy it.” | Funding options found, address copied safely, deployment review reached, completion destination understood. |
| Send, swap, approve | Send; Swap; dApp approvals | “Send a token, swap it, then decide whether to approve the waiting dApp request.” | Amount/asset preserved, review facts checked, origin and capability understood, no accidental approval. |
| Separate-profile multisig | Argent multisig | “Create a shared account, add a remote participant, exchange an intent, sign it in another profile, and submit it.” | Address/public-key choice understood, payload handoff found, threshold progress understood, one intent submitted. |
| Network degradation | Home offline; stale activity; service/rate-limit failures | “Find what remains usable, determine how fresh the data is, and recover when service returns.” | Cached state recognized, network indicator explanation found, retry does not imply duplicate submission. |

## Accessibility pass

Repeat the send review, dApp approval, and multisig intent tasks in every condition below:

- 400 × 760 side panel and the minimum 380 × 600 popup preset;
- browser text zoom at 200%;
- keyboard only, including visible focus, disclosures, copy controls, cancellation, and completion;
- reduced motion enabled.

Any cropped action, horizontal overflow, focus trap, missing label, unreadable content, or task that
requires a pointer is a release-blocking P1 until fixed and re-observed.

## Observation record

Create one record per participant. Do not collect wallet identifiers or entered content.

```md
Participant: P__ (non-team role only)
Build SHA / UI Lab checksum:
Browser / OS:
Input and display condition:

| Task | Completed unassisted? | Time | Backtracks | Longest hesitation | Misunderstood copy | Accidental action | Notes |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| Create and restore | | | | | | | |
| Fund and deploy | | | | | | | |
| Send, swap, approve | | | | | | | |
| Separate-profile multisig | | | | | | | |
| Network degradation | | | | | | | |
```

Hesitation means no progress for ten seconds. Backtracking means returning to an earlier step to
find information or recover context. Mark an action accidental when the participant says its
effect differed from their intent.

## Release decision

Triage observations by impact, not visual preference:

- **P0:** unsafe signing, funds/recovery risk, or an impossible core task;
- **P1:** a core task cannot be completed unassisted or an accessibility condition blocks it;
- **P2:** repeated hesitation, backtracking, or misunderstood copy with a recoverable path;
- **P3:** isolated polish with no measurable task impact.

Trusted-testers rollout requires every task to have been observed outside the team, no open P0/P1,
and a linked record for every P2 decision. Public rollout additionally requires the same tasks in a
fresh packaged-extension profile on Sepolia; the fixture-only UI Lab cannot prove extension,
hardware, or network integration.
