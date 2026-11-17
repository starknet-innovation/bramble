---
name: bramble-ui-ux
description: Bramble's brand, copy and UX rules for any change a user can see — a screen, a component, a style, an icon, or a user-facing string (labels, errors, toasts, approval and review text). Use before editing UI, UX or copy in the wallet, the onboarding tab, UI Lab or the website. Points to the canonical sources instead of repeating them.
---

# Bramble UI, UX and copy

Read this before you touch anything a user sees. It is a map, not a rulebook: each section names
the file that owns the rule. When this page and a source disagree, the source wins; fix this page.

## 1. Truth comes first

These outrank brevity, polish and brand. Breaking one is a bug, not a style choice.

- **Never sugar-coat funds, crypto or security.** Say what is true about balances, fees, keys,
  Ledger and privacy, even when it is unwelcome.
- **A lost reply is "status unknown",** never "failed" or "not sent". Never invite a blind retry or
  a second send.
- **Never hide a fee the user paid,** and never show someone else's fee as theirs.
- **Activity records only things that happened.** A signature handed to a dapp is not a
  transaction.
- **No raw developer errors.** Map wallet-internal errors to copy; keep a service's own
  diagnostic visible when it is the useful fact.
- **Approval, review and signing text says exactly what will be signed.** Edit it as a reviewed
  group against "did we lose a fact?" (see `docs/COPY_STYLE.md` → "Copy that is not copy").

## 2. Brand

- **Voice:** `docs/COPY_STYLE.md` → "Voice". The wallet talking to one person about their own
  money: plain, specific, calm. Second person; Bramble, never "we"; no "please", "sorry" or "!".
- **Colour and skins:** `packages/presentation/ui-kit/src/theme/skin.ts` (the token contract),
  `default-skin.ts` (light, "daylight") and `dark-skin.ts` (dark, "midnight", the default build).
  Read the header comments: one brand hue (the accent); green only for positive, red only for
  danger, orange only for degraded data; solid fills, never gradients or glass.
- **Type, spacing, radius, motion:** `packages/presentation/ui-kit/src/theme/tokens.ts`. Each
  step has one role, documented next to it. System UI font; mono for addresses, hashes and
  amounts.
- **Brand mark:** `packages/presentation/ui-kit/src/components/brand-mark.ts`. It must stay
  identical to `apps/website/public/brand/mark.svg` and the toolbar icons rendered by
  `scripts/render-brand-assets.ts`. Never redraw or recolour it ad hoc.

## 3. Copy

1. Read `docs/COPY_STYLE.md` → "Every word counts" (eight rules) before adding or editing a
   string. The short version is in `AGENTS.md` → "Writing copy".
2. Run `bun run check:copy`. It never fails the build; treat each hit as a question. Patterns live
   in `scripts/copy-policy.ts`.
3. Don't reword the exempt categories casually: activity summaries are data (dedup guards match
   on them), and approval/review/signing sentences are security text.
4. Update the string assertions that break in the same commit; they show where a string is
   load-bearing.
5. List every new or changed user-facing string in the PR body under "Copy for owner review".

## 4. Styling

- Colours come only from skin tokens (`var(--bramble-…)`); spacing, radius, type and motion only
  from `tokens.ts`. No hard-coded hex values or pixel sizes in stylesheets.
- A new colour role means a new skin token in both skins, and
  `packages/presentation/ui-kit/tests/theme/skin-contrast.test.ts` must hold it to contrast.
- Reuse UI Kit components (`packages/presentation/ui-kit/src/components/`) before adding one.
- Check both skins and the narrowest side-panel width, not just your default view.

## 5. UX patterns most often broken

- One subject per screen; the heading or the control already says it, so don't say it again.
- The control carries the user's verb ("Send", "Approve"), not the system's ("Submit", "OK").
- State the consequence; don't collect a tick box for something the user can't act on.
- Don't narrate internals (RPC, proofs, retries) or reassure in advance.
- A number appears in one place.
- Approvals must stay reachable and scrollable to their action, and never be duplicated.
- Multisig flows follow `docs/MULTISIG_UX.md`; user-tested changes follow
  `docs/UX_VALIDATION.md` (participant tasks, accessibility pass, release decision).

## 6. Verify before you open the PR

- `bun run --filter @bramble/ui-lab dev` renders every screen at real size from the production
  templates. Review the changed journey there, in both skins.
- For a real-browser check: `bun run build`, then `BRAMBLE_E2E_LIVE_NETWORK=1 bun run dev:session`
  (development fixture only; never real funds).
- `bun run check` must pass, including the contrast and copy tests.

## Related skills

Motion and polish: `emil-design-eng`, `apple-design`, `animation-vocabulary`, and
`review-animations` for reviewing motion code. They are generic; this skill is the
Bramble-specific layer.
