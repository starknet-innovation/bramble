# design-mobile: iOS design-system parity and phone optimisation

Status: implemented on this branch (2026-09-24); section 11 records what was done and what is
still open. Branch `mobile/design-mobile`. Scope is presentation only:
`mobile/ios/Bramble/DesignSystem`, the screen layouts under `mobile/ios/Bramble/Screens`, the
mobile asset generator (`scripts/mobile-assets*`), and iOS tests. Behaviour does not change: every
flow, copy string, and wallet decision stays as it is today. Android is out of scope and belongs to
the android-parity workstream.

## 1. Principles

1. **The extension is the specification.** Each metric comes from `packages/presentation/ui-kit`
   tokens, from the rendered side-panel stylesheet (`SIDEPANEL_STYLES`, built by
   `packages/presentation/wallet-ui/src/sidepanel/styles/index.ts`), or from a UI Lab story. When a
   value is not already generated, we extend `bun run mobile:assets` to produce it; we never type it
   into Swift.
2. **Phone-width rules win.** A phone is narrower than 520 CSS px, so the extension's own
   `@media (max-width: 520px)` and `@media (max-height: 760px)` rules are what an iPhone should show.
   They are not free choices.
3. **New platform behaviour must be named and justified.** The extension has no haptics, no Dynamic
   Type, no sheet detents, and no swipe-back. Mobile adds each one below, says why, and ties each
   to an existing token (for example SPRING or TYPE) so nothing is invented.
4. **Keep every existing protection.** The PrivacyCover overlay, `.privacySensitive()`, masking the
   phrase while the screen is captured, the SecureField traits, and the local-only expiring
   clipboard all stay in place through the restyle (see section 6).

## 2. Elevation (Required 1)

### 2.1 Source of truth

- `SHADOW` in `packages/presentation/ui-kit/src/theme/tokens.ts` has five tiers. Tiers `xs`, `sm`,
  `md` and `lg` are published as `--bramble-elev-*`, and `--bramble-shadow` and
  `--bramble-shadow-sm` are aliases for `lg` and `sm`. `BrambleShadow.{xs,sm,md,lg,up}` is already
  generated.
- What is missing is **which component uses which tier**. The extension uses shadows sparingly:
  only about 15 selectors have one. Every grouped card (callout, menu/option lists, receipt,
  address book, disclosure, address line, reveal value, action tiles, token rows) and every control
  (`button { box-shadow: none }`) is flat.

### 2.2 Generator: `scripts/mobile-assets/elevation.ts` (new)

- Input: the rendered `SIDEPANEL_STYLES` string. Using the rendered CSS rather than the TS sources
  means the interpolated `${SHADOW.xs}` in `styles-send-outcome.ts` and the `var(--bramble-shadow*)`
  aliases resolve the same way.
- Parse every `box-shadow` declaration together with its selector list and the media query around
  it. Resolve `var(--bramble-elev-*)`, `var(--bramble-shadow)` and `var(--bramble-shadow-sm)`
  through the `:root` declarations in the same string, then match the literal value back to a
  `SHADOW` key by exact string equality. Ignore inset values (hairlines, focus rings) and hairline
  rings. Record `none` explicitly.
- Hold a **component table** in the generator, `ELEVATION_COMPONENTS`, that maps a Swift
  identifier to a CSS selector, for example `dock: ".wallet-dock"`. Only the selector lives in this
  table; the tier is always read from the CSS. The generator fails when:
  - a listed selector has no box-shadow rule, or has a value outside `SHADOW`;
  - a phone-width media override exists but no `phone` variant is emitted;
  - the stylesheet has a non-inset elevation selector that is neither listed nor in a reviewed
    `ELEVATION_IGNORED` list with a reason. This way a new shadow in the extension cannot drift
    silently.
- Implementation: the reader is `scripts/mobile-assets/css.ts` (rules, `@media` and `@keyframes`
  conditions, `var()` resolution, `calc()`), the tables are `scripts/mobile-assets/elevation.ts`.
  The same reader also feeds `BramblePress` (per-component `:active` scales),
  `BrambleBreakpoint` (the 520/760 conditions, which must exist in the stylesheet),
  `BrambleMetrics` (`scripts/mobile-assets/metrics.ts`: per-component paddings, gaps, radii,
  heights, type sizes, weights, tracking, animation durations, including the `…Phone` and `…Short`
  media variants), and inline component colour mixes (`scripts/mobile-assets/component-colors.ts`:
  the pressed action tile and the token-mark tones). The invalid recovery word does not mirror its
  mix: fields are flat on the phone (see section 6), so it uses the `dangerSoft` fill like every field.
- Output: a new `enum BrambleElevation` appended to `BrambleTokens.generated.swift` by
  `scripts/mobile-assets/swift.ts`. It has one `static let` per component, of type
  `BrambleShadowStyle?`, where nil means `none`. The phone-width override is emitted as a second
  member (e.g. `onboardingWizardPhone = nil`). It is added through `renderMobileAssets`, so
  `tests/conformance/mobile-generated.test.ts` byte-checks it with no change to the test. The Kotlin
  renderer is not touched here; android-parity can call the same parser.

### 2.3 Component map (the current extension tiers; the generator is authoritative)

| Swift component | CSS selector | Tier | Swift today | Change |
|---|---|---|---|---|
| `SegmentedControl` selected chip | `button.seg-option[aria-pressed=true]` | xs | xs | switch to generated name |
| (send task list, future) | `.send-task-list` | xs | n/a | listed, not used yet |
| `RequestCard` (future dApp) | `.request-card` | sm | n/a | listed |
| `OnboardingAccountRow` pressed/selected | `.onboarding-account[aria-pressed=true]` | sm | none | add |
| `OnboardingContractRow` selected | `.onboarding-contract[aria-pressed=true]` | sm | n/a | add if the row exists |
| `Dock` | `.wallet-dock` | md | md | generated name |
| `QRCard` (Receive) | `.qr-card` | md | md, inline in ReceiveView | extract `QRCard` |
| `OnboardingCard` | `.onboarding-wizard` / `.onboarding-complete` | md, **none at <=520px** | md always | phone: none, radius 0, full bleed |
| `RecoverySuggestions` popover | `.recovery-suggestions` | md | n/a | add when the suggestions list is restyled |
| `Toast` | `.toast` | lg | lg | generated name |
| `AccountsSheet` / drawer | `.account-drawer` | lg | system sheet | see 4.6 |
| Portfolio menu | `.portfolio-menu` | lg | n/a | listed |

`BrambleTheme.brambleShadow` keeps mapping CSS blur B to SwiftUI `radius: B/2`, because CSS blur
is two Gaussian sigma. The parity capture in section 3 verifies this per tier. If the captures
differ by more than the tolerance, only the conversion in `brambleShadow` changes, and the tokens
stay as they are.

A new `func elevation(_ style: BrambleShadowStyle?)` view modifier applies the style, or nothing
when it is nil. Screens stop calling `.brambleShadow(BrambleShadow.md)` directly, and a Swift unit
test greps the sources to fail on any direct `BrambleShadow.` use outside `DesignSystem/`.

## 3. Pixel parity (Required 2)

### 3.1 Capture procedure

- **Extension:** `cd apps/ui-lab && bun run storybook` (port 6006). Catalog stories use
  `&args=theme:light|dark`. Journey stories use `?scenario=&checkpoint=`, and the theme is changed
  through the lab chrome's `button[data-theme=light]`. The viewport is the **full scene size
  with no safe areas**, 390x844 (iPhone 16 points), plus 375x667 (SE) and 440x956 (Pro Max). This
  is the same measurement the mobile build uses for its breakpoints (4.7), so both sides get the
  same `max-width`/`max-height` rules. Captures run under
  a small Playwright script in the scratchpad, never committed, with DNS blackholed as in the E2E
  suite.
- **Mobile:** the XCUITest snapshots from section 8.3, run on the "Bramble design-mobile" simulator
  (iPhone 16 device type) and on SE (3rd gen) and 16 Pro Max clones named
  "Bramble design-mobile SE" and "Bramble design-mobile Max".
- Both captures go at 3x into `mobile/docs/parity/<screen>-<theme>-<device>.png`. This folder is
  **git-ignored** because screenshots are review material, not source. The comparison table below
  is the committed record.

### 3.2 Screen-to-story map

| Mobile screen | UI Lab story (scenario / checkpoint) |
|---|---|
| Welcome | 01 Onboarding ChooseSetup (onboarding / welcome) |
| ImportMethod | ChooseImportMethod (method) |
| RecoveryPhrase | EnterRecoveryPhrase (recovery) |
| Passphrase | CreatePassword (password) |
| ReviewAccount | ReviewRecoveredAccounts, ChooseAccounts, AccountSelected |
| SavePhrase | GeneratedPhrase (generated-masked); **masked only** |
| ConfirmBackup | BackupConfirmed |
| Complete | SetupComplete |
| Unlock | ReturningLocked, UnlockFailed |
| Home | 02 Portfolio Ready, PricesOffline, BalanceFailed, EmptyNetwork |
| AccountsSheet | AccountDrawer |
| Receive | 07 Receive, ReceiveAddressOnly |
| Activity | ActivityAccountA |
| Settings hub / Appearance / Network / Reveal | 10 Settings Hub, Appearance, Network, RevealSoftware (masked) |
| Remove wallet | no story; compare against the Settings danger-row styling and record "no reference" |
| Components | DS 01 Foundations, 03 Feedback, 04 Data display, 06 Navigation |

### 3.3 Known differences from source

The table of differences found before implementation, with how each was resolved, is in
[design-mobile-parity.md](design-mobile-parity.md) section 1. Every fix goes through a generated
token or stylesheet metric, never a literal.

### 3.4 Comparison record

Section 10 holds one row per screen x theme x device, with status `match`, `fixed`,
`intentional (reason)` or `open`. Tolerance: size and spacing within 1pt, colour exact to the
generated token, and the same icon glyph at the same size and stroke (ICON_STROKE 1.8 and a
default size of 18). Differences in system-ui vs SF Pro glyph shapes are accepted and noted once.

## 4. Mobile optimisation (Required 3)

### 4.1 Safe areas and keyboard

- Screens lay content inside the safe area. The Dock sits at `safeAreaInset(edge: .bottom)` plus
  DOCK_OFFSET (SPACE.lg = 16), and scroll content reserves the dock height, generated as
  `BrambleSize.dockHeight`. This mirrors the extension's
  `--bramble-dock-h = 44 + 6*2 + 16`, which the generator reads from the stylesheet.
- The toast stack sits above the dock (dock-h + 12) with 12 insets, as in the extension.
- Onboarding: the full-bleed surface ignores the safe area only for its background. The CTA stack
  stays at the bottom of the safe area (`margin-top: auto`). When the keyboard is up, the CTA stays
  above it through the default SwiftUI keyboard avoidance on a `ScrollView`, and
  `scrollDismissesKeyboard(.interactively)` is set on form screens. Focus moves with `@FocusState`
  in order, and Return submits the last field.

### 4.2 Dynamic Type

- A new `BrambleTypeStyle` (DesignSystem/Typography.swift) pairs each generated TYPE token with a
  UIKit text style, for example display to `.title2`, body to `.body`, caption to `.caption1`,
  micro to `.caption2`. The pairing table lives in the generator next to TYPE, so it is
  generated. The point size is `UIFontMetrics(forTextStyle:).scaledValue(for: token)`, so at the
  default size ("Large") the rendering equals the extension exactly, and larger settings scale
  proportionally.
- Implementation note: the pairing is a platform choice (the extension has no Dynamic Type), so it
  is written once in `DesignSystem/Typography.swift` (`BrambleTypography.textStyle(for:)`, by
  token size) rather than generated. Text also renders on the CSS line box: the `line-height`
  leading is split above and below each line, so blocks are as tall as in the extension, and CSS
  weights between named weights (650) interpolate on UIKit's weight axis.
- Spacing that tracks text (row min-heights, icon sizes next to text) uses
  `@ScaledMetric(relativeTo:)` based on the same token.
- The ceiling is `.accessibility3` for chrome (the dock and header) using
  `dynamicTypeSize(...DynamicTypeSize.accessibility3)`. Content is uncapped. At accessibility
  sizes, token rows and detail rows stack vertically using `ViewThatFits`, and addresses stay
  truncated middle-out through the existing `shortAddress`, which is owned by the accounts
  workstream; this workstream only consumes it.

### 4.3 Hit targets

- The extension's 40px icon buttons and 34px segment options keep their **visual and layout**
  size. `.frame(minHeight: 44)` is not used, because it changes layout (the segment track would
  grow from 40 to about 50 and shift the header and dock). Instead a `hitTarget(width:height:)`
  modifier (DesignSystem/HitTarget.swift) expands only the hit region:
  `.padding(d).contentShape(Rectangle()).padding(-d)`, where `d = max(0, (44 - side) / 2)` per
  axis. The laid-out frame is unchanged, so the 1pt pixel-parity tolerance in 3.4 still holds.
  The 44 comes from `BrambleHit.minimum`, a named Apple HIG constant written once in
  DesignSystem/HitTarget.swift; it is a platform rule, not an extension token, so it is not
  generated.
- **Overlap between neighbours.** The expansion is applied per axis only where it is needed:
  - Segment options are at least 44pt wide inside any real track, so they expand **vertically
    only** (34 to 44: 5pt above and below, reaching 2pt outside the 3pt track padding). Adjacent
    options never overlap because nothing is added horizontally.
  - Icon buttons expand by 2pt per side (40 to 44). The header actions sit 4pt apart (`SPACE.xs`),
    so two expanded regions meet exactly at the midpoint of the gap and do not overlap. Where a
    gap is smaller than `2d`, the modifier is given the gap (`hitTarget(…, gap:)`) and expands by
    `min(d, gap / 2)` on that axis, so the regions still meet at the midpoint and never overlap.
- **Test.** In practice SwiftUI reports the expanded content shape as the element's accessibility
  frame, so `XCUIElement.frame` is the 44pt region, not the 34/40pt visual. `HitTargetTests`
  therefore asserts that the frame is at least 44pt and taps inside the expansion band (1pt inside
  the region's top edge of a segment, 4pt above the visible pill; 0.5pt inside an icon button's
  edge, 1.5pt outside the visible circle) and asserts the action ran: the Light segment selects,
  Back pops, the header lock locks. The planned "tap just past the region does nothing" check was
  dropped: a tap 6pt beyond the 44pt region still selected the segment, because iOS applies its
  own touch tolerance to synthesized taps, so that negative check cannot be made reliable. The
  visual size is held by the layout metrics and the snapshots, not by this test.

### 4.4 Haptics (new behaviour; the extension has none)

A single `Haptics` facade (DesignSystem/Haptics.swift) uses iOS 17 `.sensoryFeedback`:

| Trigger | Feedback |
|---|---|
| Primary PillButton completes an action (Continue, Unlock success, Create, Copy address) | `.success` for completion, `.impact(.light)` on press |
| Error toast, unlock failure, validation error | `.error` |
| Segment change, account switch, theme change | `.selection` |
| Toast swipe dismiss past threshold | `.impact(.soft)` |

Haptics add no information beyond what is already on screen (security note, section 6). Haptics
follow the system switch, and there is no in-app setting.

### 4.5 Motion

- `BrambleSpring` maps to `.spring(response:dampingFraction:)`. Uses: `default` for presses,
  `drawer` for sheets and the drawer, `momentum` for toast entry, `snappy` for segments. SwiftUI
  springs are interruptible by construction, and gestures retarget with velocity through
  `withAnimation(.interpolatingSpring…)` using the same response and damping.
- Press envelope: the scales are generated per component (control 0.98, icon/dock 0.96, seg 0.97,
  tile 0.97, drawer row 0.985). The generator reads them from the stylesheet `:active` rules, and
  the extension test keeps them inside 0.95 to 1.0.
- Toast: entry from `y +18, scale 0.95, opacity 0`. Auto-dismiss after 3200ms for success and
  8000ms for error; these durations are generated from `dom.ts` constants moved into tokens only if
  already exported, otherwise they are added to the parity fixture (section 7). Horizontal swipe
  dismisses when velocity exceeds 0.11 px/ms or the drag exceeds 80, and opacity follows
  `1 - |dx|/220`.
- Navigation push and pop use the system NavigationStack transition. The extension's +12/-8px
  direction-aware transition is intentionally not reproduced: iOS users expect the system push,
  and it brings interactive swipe-back.
- **Reduced motion** (`@Environment(\.accessibilityReduceMotion)`): no travel, scale or spin, and
  the degraded-dot pulse is removed. Only opacity and colour fades remain, over MOTION.press, which
  matches the extension's reduced-motion block. `BrambleMotion.animation(_:)` returns the fade
  whenever reduce motion is on, so call sites cannot forget it.

### 4.6 Navigation, swipe-back and sheets

- **Swipe-back, the real mechanism.** Two stacks exist and they are handled differently:
  - **Onboarding** is not a `NavigationStack`. `OnboardingFlow` keeps a custom
    `@State steps: [Step]` stack inside `OnboardingCard`, with its own direction-aware move
    transition, `push`, `pop`, and `replace(with:)`. It stays that way (moving it into
    `NavigationStack(path:)` would replace the transition and the `replace` semantics with system
    behaviour we would then have to fight). Swipe-back is added as a leading **edge-swipe gesture**
    (DesignSystem/EdgeSwipeBack.swift, `edgeSwipeBack(enabled:action:)`) that calls the existing
    `pop()`. It recognises a drag that starts within 24pt of the leading edge and ends with a
    translation past 80pt or a predicted end past 160pt, and is ignored when vertical travel
    dominates. The gesture only runs `pop()` on release; no partial state change happens during the
    drag.
  - **The existing rules still hold.** `replace(with:)` resets `steps` to one element, so after the
    vault is written there is nothing behind the current step. On top of that, the gesture is
    enabled **only** on the pre-vault steps `importMethod`, `recoveryPhrase` and `passphrase`
    (`Step.allowsSwipeBack`). It is disabled on `welcome` (the root), and on `reviewAccount`,
    `savePhrase`, `confirmBackup` and `complete`, which all come after `replace` has run.
    `confirmBackup` keeps its visible Back button (behaviour unchanged), but a stray edge swipe
    there cannot drop the typed answers. `importedPhrase` is handed off when the passphrase step
    submits and is then cleared, exactly as today. `pop()` additionally clears `importedPhrase`
    when it leaves `.passphrase`: the recovery step always remounts with empty cells, so the old
    copy is unreachable and clearing it only shortens its lifetime in memory.
  - **Wallet flows** (Receive, Network, Appearance, Reveal, Remove) are in
    `NavigationStack(path:)` with the navigation bar hidden. UIKit disables the interactive pop
    gesture when the bar is hidden, so these screens get the same `edgeSwipeBack` modifier, calling
    `dismiss()`. It is disabled on Reveal entirely (the screen wipes its words on disappear, and
    an accidental swipe is not a way to leave a secrets screen we want to encourage; the Back
    button stays) and on every flow while the core is busy.
  - **Test.** `SwipeBackTests` (XCUITest) drags from the leading edge (normalised x 0.01 to 0.85)
    and asserts that `importMethod`, `recoveryPhrase` and `passphrase` return to their previous
    step, and that the same drag leaves `reviewAccount`, `savePhrase`, `confirmBackup` and
    `complete` on screen. It also checks swipe-back on the Network flow in the wallet.
- The AccountsSheet stays a system sheet on phone with detents `[.medium, .large]`, a visible drag
  indicator, `presentationCornerRadius(BrambleRadius.xl)`, and the panel background. The
  extension's left drawer is a desktop side-panel idiom, and a bottom sheet is the platform
  equivalent. The drag math (-35% dismissal, rubber-band) is left to the system. This is recorded
  as an intentional difference. The drawer's row metrics (min-h 56, gap 10, name body 650, address
  as caption code) and the lg elevation (no shadow on a system sheet; the sheet's own dimming
  applies) are matched.
- Confirmation screens (Reveal, Remove wallet) are unchanged; this design does not touch them.

### 4.7 Device classes

**One measurement on both sides.** A CSS viewport is the whole browser window, with no safe
areas, and the UI Lab captures in 3.1 use full-screen viewports (390x844 and so on). The mobile
build therefore evaluates the extension's breakpoints on the **full scene size, ignoring safe
areas**: `GeometryReader` height plus `safeAreaInsets.top + safeAreaInsets.bottom`
(`DeviceClass.resolve(size:insets:)`, DesignSystem/DeviceClass.swift). An iPhone 16 is 844pt
tall as a scene even though only about 751pt of that is inside the safe area, so it gets the base
rules, the same as its 390x844 UI Lab capture. The class comes from the scene size, not the device
model, so Zoom and larger text settings work.

| Device | Scene (pt) | UI Lab viewport | `max-width: 520` | `max-height: 760` | Class | Rule |
|---|---|---|---|---|---|---|
| iPhone SE (3rd gen) | 375x667 | 375x667 | yes | **yes** | `short` | step top padding 30, bottom 22, head margin 40/8 |
| iPhone 16 | 390x844 | 390x844 | yes | no | `regular` | base rules |
| iPhone 16 Pro Max | 440x956 | 440x956 | yes | no | `regular` | base rules |

All three are phone width, so the full-bleed onboarding rules apply to all of them. The content
itself is laid out inside the safe area; only the breakpoint decision uses the full scene.

## 5. Feedback components (Required 4)

These are new files in DesignSystem, each under 500 lines:

- `Callout(icon:title:body:role:action:)`: panel fill, radius lg, padding 12/16, no shadow; a
  34x34 icon chip on accent-soft; title body 14; copy caption 12 muted. The accessibility trait
  follows `role`: note is static text, status updates, and alert posts a VoiceOver announcement.
- `EmptyState(message:)`: centred muted label 13, line height 1.45, padding 16/12, **no box or
  icon**, matching the extension's rule that an empty list is an absence. The copy strings are the
  extension's own and come from the parity fixture.
- `ErrorPanel(message:retryLabel:action:)`: the extension's `.panel-error`, centred, gap 8, with a
  ghost small button carrying the refresh icon and the label "Try again". The accessibility label
  is supplied by the caller, e.g. "Retry loading balances". The message is the host's
  `describe(error)`, which never contains input.
- `Pill(label:dot:icon:tone:)` plus `HardwarePill` and `CountBadge(count:)`. CountBadge rejects
  negative values with a precondition in debug builds and hides in release builds, which mirrors
  the extension's throw.
- `Toast` rebuilt with success and error tones, the copy-details button (full `details`, local-only
  pasteboard with a 120s expiry, and a check glyph for 1400ms), and a stack host.
- **Loading.** The extension has **no skeleton or shimmer**, so mobile does not add one. Required 4
  says "skeleton"; we meet it faithfully with:
  - `Placeholder` ("—") for unknown values;
  - `LiquidDots` (two 24pt dots, travel 16, 2000ms loop, compact 8pt), ported from
    `styles-progress.ts` values emitted by the generator;
  - `BusyRefreshIcon` (800ms linear spin, static under reduced motion);
  - `busy` on PillButton (opacity 0.7, Liquid Dots in place of the label, `.updatesFrequently`
    removed, VoiceOver value "Busy").

  If review insists on a shimmer, it has to be added to the extension first.

## 6. Threat model and mitigations

This work adds no key material, no FFI surface, and no storage. The risks come from restyling
surfaces that show secrets.

| Threat | Mitigation |
|---|---|
| A restyled phrase grid drops `.privacySensitive()` or capture masking | The component keeps both. A unit test checks the modifier chain by inspection of the view via `accessibilityIdentifier` in masked mode, and an XCUITest asserts that the words are not in the accessibility tree while masked. |
| VoiceOver reads recovery words or the password | Masked words are `accessibilityHidden` behind one element labelled "Recovery phrase hidden". Words, passwords and addresses of secrets never go in `accessibilityValue` or a hint. |
| New sheets and toasts appear above PrivacyCover in the app-switcher snapshot | The cover moves to a top-level overlay window attached at scene level, so it covers sheet presentation contexts too. An XCUITest backgrounds the app with a sheet open and checks that the cover exists. |
| Snapshot tests capture a real phrase | The snapshot suite uses only the repository's published test phrase. It rejects the `BRAMBLE_MOBILE_MAINNET_MNEMONIC` override and fails if it is set. It captures phrase screens only in masked state. |
| Error components echo user input | Components take a display string only, and callers pass `describe(error)`, which already excludes input. |
| Copy button leaks error details to Universal Clipboard | `UIPasteboard.setItems(_, options: [.localOnly: true, .expirationDate: +120s])`, the same as address copy. |
| Haptics act as a side channel | Haptics fire only on events that are already visible, and are never keyed to secret content. |
| SecureField traits lost when restyling BrambleField | `SecureField`, `.textContentType(nil)` (secrets are never offered to AutoFill, per vault-security) and `.autocorrectionDisabled()` stay. A unit test instantiates the field and checks its traits through `UITextField` introspection in a host view. |

No mainnet broadcast, no spend, and no network use in the default suites.

**Offline RPC seam (new, Debug only).** `RpcClient` today always posts to
`network.rpcUrls`, and no recorded RPC responses exist. The seam is designed explicitly:

- `RpcTransport` (App/RpcTransport.swift, new file) is a one-method protocol,
  `post(_ body: String, to url: URL) async throws -> String`. `URLSessionTransport` is the
  production implementation and holds the ephemeral session that `RpcClient` holds today.
- `RpcClient` gains one additive injection point: `RpcClient.transport`, a static that defaults to
  `URLSessionTransport()`, and `post` delegates to it. The request building and response judging
  stay in the Rust core, unchanged. `WalletStore` is **not** changed; it keeps
  `private let rpc = RpcClient()`.
- `BrambleApp.init` installs the fixture transport only under `#if DEBUG` and only when the
  launch argument `-uiTestOfflineFixtures <state>` is present. In a Release build the code does
  not exist, so the flag does nothing.
- `FixtureTransport` (App/FixtureTransport.swift, `#if DEBUG`) answers from
  `RpcFixtures.generated.swift`, which `bun run mobile:assets` renders from
  `STARKNET_NETWORKS` and `DEFAULT_TOKENS`, so the fixtures are generated, never hand-written, and
  byte-checked by `mobile-generated.test.ts`. Each Home state is one fixture:
  - `ready`: `starknet_chainId` answers the network's chain id, and every `starknet_call` answers a
    fixed non-zero u256 per token;
  - `empty`: the same, with every balance zero;
  - `balanceError`: every request fails, so `networkHealthy` goes false.
  The transport echoes the request `id` and chooses the answer by `method` and the called token
  address. The core then judges these responses exactly as it judges live ones, so the fixtures
  also exercise the real response path.
- The UI tests pass `-network sepolia` as well, so even a wiring fault could only reach a test
  network, and no request is sent to a live host.

The mainnet UI suite that already exists (`OnboardingFlowTests`) is unchanged, and it is the only
suite that uses a live network. The new suites never do.

## 7. UniFFI surface, storage, and parity fixtures

- **UniFFI:** **none added.** No Rust signature changes, and `mobile/core/src/lib.rs` and
  `Cargo.toml` are untouched. Nothing new crosses the boundary. What never crosses stays as
  SCOPE.md defines it: private keys, viewing keys and vault keys never cross, and the phrase
  crosses only at creation and on a reveal that re-checks the password.
- **Storage:** no new persisted state. The theme stays `@AppStorage("theme")`. Haptics and reduced
  motion follow system settings. No migration is needed.
- **Generated assets (`bun run mobile:assets`):** the additions are `BrambleElevation`, the
  TYPE-to-text-style pairing, per-component press scales, `dockHeight`, the Liquid Dots metrics,
  the new colour mixes, and the phone and short-height layout variants. All are rendered from the
  extension's TS or `SIDEPANEL_STYLES`, and all are byte-checked by `mobile-generated.test.ts`.
- **Toast behaviour (changed from the first draft):** the toast lifetimes (3200/8000 ms), the
  swipe thresholds (0.11 px/ms, 80 px, fade over 220 px), the copy confirmation (1400 ms) and the
  three copy-control labels are private constants in `shared/dom.ts`. Rather than adding exports
  to the extension, `scripts/mobile-assets/feedback.ts` reads that source text (as `colors.ts`
  reads the stylesheet source) and emits `enum BrambleToast` into the generated Swift; a change
  of shape throws. No `presentation.json` parity fixture was added, so the shared
  `extension-parity.json` and `bun run mobile:parity` are untouched, and `packages/` is unchanged.
  Empty-state and panel-error strings are still written in the Swift screens (see section 11).
- **krusty-kms:** not involved. Nothing is blocked on krusty-kms 0.11.0.

## 8. Test plan

### 8.1 Generator and conformance (bun)

- `tests/scripts/mobile-elevation.test.ts`: parses the real `SIDEPANEL_STYLES` and checks every
  listed component's tier. It fails on an unknown shadow value, an unlisted non-inset shadow
  selector, a missing phone variant, or an alias that does not resolve. Fixture CSS covers the
  `${SHADOW.xs}` literal and the `var(--bramble-shadow-sm)` alias.
- `mobile-generated.test.ts` covers the new output automatically through `renderMobileAssets`.
- The full `bun run check` runs, and `packages/presentation` is unchanged apart from any export
  additions.

### 8.2 Swift unit tests (BrambleTests)

- `ContrastTests`: WCAG luminance over the generated `BrambleSkin`, for both skins, with the same
  thresholds as `skin-contrast.test.ts`: inks at least 4.5 on every ground, border at least 3,
  accent-text on accent, bg on danger, avatar inks, and accent/danger on their soft fills. The
  test's rounding is matched.
- `ElevationUsageTests`: implemented as a bun conformance test instead
  (`tests/conformance/mobile-design-system.test.ts`), so it runs in `bun run check`.
- `TypographyTests`: at the `.large` content size the scaled size equals the token, and it is
  monotonic across sizes.
- `DesignSystemTests`: device-class breakpoints, hit expansion, the edge-swipe recogniser, the
  650 weight, token-mark tones, and the generated elevation tiers.

### 8.3 XCUITest (`BrambleUITests/SnapshotTests.swift`, new)

- Destination: `platform=iOS Simulator,name=Bramble design-mobile`, plus the SE and Max clones
  from 3.1. Never "iPhone 16".
- Launch arguments: `-theme dark|light`, `-network sepolia`, `-uiTestOfflineFixtures
  ready|empty|balanceError` (the Debug-only seam in section 6; no live host is contacted), and
  `-UIPreferredContentSizeCategoryName` for the large-type pass. A reduced-motion pass passes the
  `UIAccessibilityReduceMotion` launch environment.
- For each screen in 3.2 and each theme, capture an `XCTAttachment` (keepAlways) named
  `<screen>-<theme>-<device>`. After capture, assert the VoiceOver label, trait and hint of every
  control, and on phrase screens assert masking. Hit regions are checked by `HitTargetTests`
  (4.3), not by frame size.
- Also covered: swipe-back as specified in 4.6 (`SwipeBackTests`), the sheet detent change on AccountsSheet, and
  keyboard avoidance (the Continue CTA is hittable with the keyboard up on SE).
- A helper, `scripts/mobile-parity-shots.sh` (dev-only, never CI), exports the attachments from
  the `.xcresult` into `mobile/docs/parity/`.

## 9. Out of scope and dependencies

- New features: Nostr, multisig/Argent account creation, fiat totals, the explorer-backed
  activity feed, address copy, and account naming belong to their own workstreams. This design
  only styles what exists, and provides components (Callout, EmptyState, ErrorPanel, Pill, Toast,
  LiquidDots) that those workstreams should reuse.
- Android: the elevation parser is reusable, but Kotlin emission is left to android-parity.
- Biometric unlock, idle auto-lock and back-off (Phase 1.3): the Unlock layout keeps room for a
  biometric affordance but shows none.
- Shared files: `WalletShell.swift` receives only small, additive changes (dock offset and badge
  slot, generated elevation name). `SettingsViews.swift` receives only the masking and a11y
  modifiers. `WalletStore.swift` is not touched. `RpcClient.swift` gains the additive static
  `transport` injection point, and `BrambleApp.swift` the `#if DEBUG` launch-argument hook
  (section 6).
- Risk: the cascade order of the duplicate `.eyebrow` rule, and whether `blur/2` matches CSS blur,
  are resolved by capture before any token change.

## 10. Comparison record

The per-screen comparison record lives in [design-mobile-parity.md](design-mobile-parity.md)
section 2, so this document stays under the 500-line file limit.

## 11. Implementation status

See [design-mobile-parity.md](design-mobile-parity.md) section 3 for what was done, what is still
open, and the gate results.
