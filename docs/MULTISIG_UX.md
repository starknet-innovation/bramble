# Multisig journey model

The multisig experience uses one mental model: choose or join a shared account, complete the
required task in a linear flow, then land on that shared account. Network work may make a button
busy, but it does not become a user-facing step.

## Journey matrix

| Journey | Entry | Linear path | Terminal destination |
| --- | --- | --- | --- |
| Create | Shared accounts > Create | Participants > Approval > Fund if needed > Deploy | Deployment receipt > shared account |
| Join deployed | Shared accounts > Add address | Address > Sync | Shared account |
| Join undeployed | Shared accounts > Add address | Address > Save | Shared account > resume Create at Participants |
| Resume saved setup | Shared account > Deploy | Approval > Fund if needed > Deploy | Deployment receipt > shared account |
| Fund locally | Create > Fund | Amount > Review > Confirm | Resume the same Create flow at Fund |
| Fund externally | Create > Fund | Copy or scan address > Check funding | Continue the same Create flow to Deploy |
| Propose | Shared account > Send | Recipient and amount > Review transaction | Focused signing intent |
| Import | Intents > Import intent | Paste > Verify and import | Focused signing intent |
| Approve | Focused signing intent | Review > Sign or add signature > Submit when ready | Submission receipt > Activity or shared account |
| Manage signers | Shared account > Signers | Choose change > Participant if needed > Review | Focused configuration intent |
| Receive | Shared account > Receive | Copy or scan address or public key | Return to shared account |

## Creation stages

Only decisions and recoverable user tasks appear in progress:

1. **Participants** — account name and signer set.
2. **Approval** — signature threshold, deployment signer, and advanced salt.
3. **Fund** — predicted address and local or external funding. A funded account passes this stage
   automatically.
4. **Deploy** — exact address, authority, and maximum fee review followed by submission.

Address calculation is system work inside the Approval action, not a step. Submission is a receipt,
not a misleading “Done” step: deployment may still be confirming on Starknet.

## Interaction rules

- One primary action advances each screen; Back reverses one user decision.
- A temporary subflow returns to its origin without adding itself to Back history.
- A saved constructor resumes at Approval; Back still exposes Participants for deliberate edits.
- Back reverses the visible creation stage before it exits the creation task.
- A busy action leaves the current screen visible and names the work in progress.
- The same nouns are used throughout: participants, approval, fund, deploy, signing intent.
- Each intent opens as a focused page; lists remain overview surfaces.
- Technical data stays behind disclosure unless it is required for consent or recovery.
- Success receipts expose the next destination instead of making the user reconstruct it.
