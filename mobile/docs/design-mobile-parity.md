# design-mobile: parity record and implementation status

Companion to [design-mobile.md](design-mobile.md). Section 1 lists the differences found before
implementation and how each was resolved. Section 2 is the per-screen comparison record. Section 3
says what is done, what is not, and the gate results.

How the comparison was made: every UI Lab story in design-mobile.md 3.2 was rendered by its
production wallet document (`walletFrameDocument`, the exact `SIDEPANEL_STYLES` and skin) in a
390x844 viewport at 3x, dark and light, through a scratchpad Playwright script against this
worktree's Storybook. The mobile side is the `SnapshotTests` attachments from the "Bramble
design-mobile" simulator (iPhone 16 device type), exported with
`mobile/scripts/mobile-parity-shots.sh` into the git-ignored `mobile/docs/parity/`. Pairs were
compared side by side at equal height.

## 1. Known differences and resolution

| Component | Extension | Before | Now |
|---|---|---|---|
| Toast radius / gap / padding | 14 / 10 / 10 12 10 10 | 20 / 12 / 10 | fixed, `BrambleMetrics.Toast` |
| Toast text | 13, weight 600 | 14 semibold | fixed |
| Toast tones and copy | success check chip; error copy button 30x30 | neither | fixed; copy is local-only, expires in 120 s, check for 1400 ms |
| Toast lifetime / swipe | 3200 / 8000 ms; 0.11 px/ms or 80 px; fade over 220 px | 3 s, no swipe | fixed, `BrambleToast` read from `dom.ts` |
| PillButton | body 14, 600, -0.01em; 46 high; 0 16 | row 16 | fixed; `small` variant added (13 / 40 / 0 12) |
| PillButton busy | opacity 0.7, label kept | spinner replaced the label | fixed |
| TokenRow | 14/650 symbol, 12 amount, bold value | 16 / 14 / 16 bold | fixed |
| TokenMark letters | 40, 12/800 +0.02em, first 3 letters, avatar-N tone | 1 letter, muted, no tone | fixed; tones are generated component colours |
| FlowHeader title | h1 22/700 -0.02em; pad 2 0 4 | headline 28 | fixed |
| NetworkPill | 28 min-h; 3 12; 12/600; dot 7 | 36; 13 semibold | fixed |
| Header status dot | 6, degraded pulses 2400 ms to 0.42 | 6, static | fixed; pulse off under Reduce Motion |
| SegmentedControl | pad 3, gap 3, option 34, 13/650 | 4 / 0 / 36 / 14 | fixed |
| Eyebrow | cascade winner 12 / 650 / 0.02em | 0.08 semibold | fixed (read from the cascade) |
| Action row / tile | gap 8; pad 8 4; radius 20; 72; 14/600 label | gap 12; caption label | fixed |
| Action tile pressed | accent 11% over accent-soft | accent-soft at 0.8 | fixed, `actionTilePress` |
| Wallet header | gap 8; trigger gap 10, pad 4 12 4 4 | 12 / none | fixed; Connected sites intentionally absent |
| Dock | 16 from the bottom; md elevation | 8 | fixed; count badge not shown (no pending count on mobile) |
| Onboarding card | full bleed at <=520: radius 0, no shadow | card, md shadow, margins | fixed |
| Onboarding step | 38 / 16 / 30; SE 30 / 22; head 46/12, SE 40/8 | 28 inner | fixed via `DeviceClass` |
| Onboarding option detail | 12 / 1.35, weight 600 (inherited from button) | 12 regular | fixed |
| Review account avatar | "01" disc | Beam avatar | fixed |
| Recovery cells | mono 12, number 12/650, gap 4, invalid tint | body 14, gap 6 | fixed |
| Recovery suggestions | panel popover, md elevation | capsule chips | restyled; stays one row above the keyboard (intentional) |
| Gate (unlock) | brand 64 at 24+24; title 28/800/-0.02em | ad hoc | fixed |
| Font weight 650 | distinct from 600 | both semibold | fixed, interpolated on UIKit's weight axis |
| Line boxes | CSS half-leading | SwiftUI line height | fixed, `BrambleTextModifier` |

## 2. Comparison record (iPhone 16, 390x844)

Status is `match` (within 1pt, same token colours, same glyph), `fixed` (a difference found in this
comparison and corrected), or `intentional` (reason given). "SE" and "Max" were not captured: see
section 3.

| Screen | Dark | Light | Notes |
|---|---|---|---|
| Welcome | match | match | Content sits inside the safe area; the reference has none. |
| ImportMethod | fixed | fixed | Option detail weight 600. Titles wrap differently: CSS `text-wrap: balance` has no iOS 17 equivalent (intentional). Ledger and Private key rows are disabled on mobile (feature absent). |
| RecoveryPhrase | match | match | |
| Passphrase | match | match | |
| ReviewAccount | fixed | fixed | "01" disc and weight 600 address. Address truncation is `shortAddress` (accounts workstream). There is no Mainnet checkbox: the extension deleted it (the 2026-09-30 port). |
| SavePhrase (masked) | fixed | fixed | The masked grid now renders no words at all (an empty blurred field), which looks the same as the extension's blurred words and keeps the words out of the view and accessibility trees. No back control after the vault is written (unchanged behaviour). |
| ConfirmBackup | match | match | |
| Complete | match | match | Only the check mark, "You’re all set" and "Open Bramble": the extension dropped the eyebrow, lede and detail rows (the 2026-09-30 port). |
| Unlock / UnlockFailed | fixed | fixed | CTA pinned at the foot, above the keyboard. The failed capture was taken while the keyboard was dismissing, so the CTA and toast sit higher than at rest. |
| Home ready | match | match | Send, Swap, Shield are disabled on mobile (feature absent). No fiat: total and value read "—" (portfolio workstream). |
| Home balance error | fixed | fixed | New `.panel-error` state, "RPC endpoints unavailable" with Try again; gap above tightened to 8. |
| Home empty | match | match | Zero balances from the fixture. |
| AccountsSheet | intentional | intentional | Bottom sheet with medium/large detents instead of the left drawer; row metrics match. Group chips and Manage are extension features absent on mobile. |
| Receive | match | match | QR card 204 with md elevation. Wallet identity and the privacy callout are absent (features absent). |
| Activity | match | match | Empty state only; the explorer-backed feed belongs to portfolio-activity. |
| Settings hub | match | match | Fewer rows (features absent); mobile keeps Lock wallet and the core version line. |
| Network | match | match | Advanced endpoints absent (feature absent). |
| Appearance | match | match | "& currency" and the Values section are absent (no fiat on mobile). |
| Reveal (masked form) | match | match | |
| Remove wallet | no reference | no reference | Styled with the shared FlowHeader, field and danger button. |

Resolved in general: status bar and home indicator exist only on the phone; the UI Lab capture is
a full-bleed viewport, so every mobile screen starts lower by the top safe area (59pt). That is
the one systematic offset and it is intentional.

## 3. Implementation status

### Done

- Elevation (Required 1): `scripts/mobile-assets/css.ts` + `elevation.ts` read every
  `box-shadow` from `SIDEPANEL_STYLES` and emit `BrambleElevation` (15 components, phone
  variants) into `BrambleLayout.generated.swift`; unlisted elevations fail generation. Screens use
  `elevation(_:)`; a bun conformance test forbids direct shadows outside the design system.
- Layout metrics, press scales, breakpoints, component colours and toast behaviour are generated
  from the stylesheet and `dom.ts` (sections 2.2 and 7 of the design).
- Pixel parity (Required 2): the pass above, both themes, iPhone 16.
- Mobile optimisation (Required 3): safe areas; CTAs pinned above the keyboard with interactive
  dismissal and field focus order; Dynamic Type through `BrambleTypography` (dock capped at
  accessibility3); 44pt hit regions without layout change; haptics (press, success on unlock and
  copy, error on error toasts, selection on segments/tabs/accounts/theme, soft on toast swipe);
  interruptible SPRING-token animations; Reduce Motion (no scale, travel, spin, or pulse); edge
  swipe-back per 4.6; sheet detents and drag indicator; `DeviceClass` short/regular.
- Feedback components (Required 4): Callout, EmptyState, ErrorPanel, LiquidDots,
  BusyRefreshIcon, rebuilt Toast with host. Pill, HardwarePill, CountBadge and Placeholder were
  removed as unused (SwiftLint's analyzer); port them again with the first screen that shows one.
- Accessibility (Required 5): labels, traits, hints and values on every control; headers marked;
  masked phrase exposed as one "Recovery phrase hidden" element; `ContrastTests` over the
  generated skins with the extension's thresholds plus the phone-only pairs.
- Snapshot XCUITests (Required 6): `SnapshotTests` (4 tests, both themes), plus `SwipeBackTests`
  and `HitTargetTests`, all offline through the Debug-only fixture seam.
- Security: the privacy cover now also goes up in its own window above sheets; copies go through
  one `SecurePasteboard`; `.newPassword` on passphrase creation; the masked phrase is never
  rendered.

### Not done

- SE and Pro Max captures and runs: this run was limited to its one simulator, so only the device
  class logic is covered (unit test). The SE keyboard-avoidance and sheet-detent XCUITests from 8.3
  were not written.
- No large-type or Reduce Motion snapshot pass was run.
- Empty-state and panel-error strings ("RPC endpoints unavailable", the Activity copy) are written
  in Swift, not generated.
- Dock count badge: the component exists but nothing on mobile has a count to show.
- CSS `text-wrap: balance` and the Liquid Dots goo filter have no SwiftUI equivalent.
- Android: out of scope (android-parity); the Kotlin renderer is unchanged.
