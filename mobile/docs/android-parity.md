# Android parity design

Status: implemented, uncompiled (section 8, in `android-parity-testing.md`). Workstream `android-parity`, branch
`mobile/android-parity`. Revised after review: every must-fix item is resolved in place and listed
in section 11.
Scope: `mobile/android/**` and Android build scripts; iOS, `mobile/core` and the extension do not
change, apart from the flagged additive script change in section 9.

## 1. Goal and non-goals

Rebuild the Jetpack Compose app in `mobile/android` so it matches the redesigned iOS app screen by
screen, copy by copy and gate by gate. Because iOS is itself a documented mobile adaptation of the
extension side panel, Android copies **iOS behaviour** wherever iOS and the extension differ. Android
does not "fix" those differences on its own, because that would give three behaviours instead of two.
The differences are listed in section 2.3 and belong to the `accounts` and `design-mobile`
workstreams, which will change iOS and Android together. One exception came out of review: the
weak-passphrase tick follows the extension, because iOS there matches neither (section 2.2).

Non-goals, owned by siblings (full list in section 10): friendly account names ("Amber Otter"),
discovery, the account-type chooser (Argent, multisig), fiat, the explorer activity feed, Nostr,
send/swap/shield, and Keystore/biometrics/back-off (these need core and SCOPE.md changes, section 6.3).

Android keeps working seams for these features so the sibling branches can plug in without rework.
The dock has an Activity tab, the home hero renders `—`, the accounts sheet has an "Add account"
button, and address truncation and copy are shared helpers (section 3.3).

## 2. User-visible behaviour, screen by screen

Copy is verbatim. "Ext" is the extension source of truth. "iOS" is the file Android ports. Compose
screens live under `mobile/android/app/src/main/java/org/bramble/wallet/ui/` (`Root.kt`,
`UnlockScreen.kt`), `ui/onboarding/` and `ui/wallet/`; components under `design/`. Every file stays
under 500 lines.

### 2.1 Routes and store

`WalletStore.kt` is rewritten to mirror `mobile/ios/Bramble/App/WalletStore.swift`:
- `Route { ONBOARDING, LOCKED, WALLET }` and `Tab { HOME, ACTIVITY, SETTINGS }`, replacing
  `WELCOME/BACKUP/LOCKED/HOME`.
- `network` persisted as `"mainnet"`/`"sepolia"` (non-secret prefs, default mainnet);
  `networkLabel` "Starknet"/"Sepolia". There is no test argument: production code takes no
  instrumentation input, and the orchestrator gives every test a fresh process on the default,
  mainnet (section 8.4).
- `pendingBackup` (words for the save/confirm steps) is cleared on finish and on `lock()`, which also
  resets `tab` to HOME and routes to LOCKED once a vault exists (ONBOARDING otherwise).
- Core calls run on `Dispatchers.Default` behind `busy`; the UI never calls `WalletCore` directly.
- **Lock epoch** (`SessionGuard.kt`). `unlock` and `reveal_recovery_phrase` run PBKDF2 in the core
  without holding its session mutex, and `unlock` installs the session only when PBKDF2 ends, so a
  lock can land while a call is still running. Every store action takes a ticket before its first
  core call; `lock()` moves the epoch on. When a call returns with a stale ticket the store drops
  the result (phrase words, accounts, route change), locks the core again off the main thread,
  re-reads whether a vault now exists (a create or import that finished after the lock routes to
  LOCKED), and fails the action with `SessionEndedException`, a `CancellationException` that no
  screen shows. Checks happen after every suspension point, so a route change can never follow a
  lock.
- `lock()` wipes UI state synchronously on the main thread and runs `core.lock()` on
  `Dispatchers.Default`, because `install()` holds the core mutex through `SealingKey::create` and
  a main-thread lock would stall behind a 600k-iteration PBKDF2. The next core call waits for that
  lock to finish first. `lock()` never calls `core.status()` (which also takes the mutex): the
  store tracks whether a vault exists itself. Since the merge with `vault-security` the core closes
  the gap from its side too: `lock()` bumps a core lock epoch and a late `unlock` reports `Locked`
  instead of installing a session. The store treats any failure of a call whose ticket is stale
  as `SessionEndedException`, so that `Locked` never reaches a screen.
- `describe(Throwable)` returns the iOS wording exactly: `WrongPassword` → "Incorrect passphrase"
  (the extension's string, generated into `BrambleCopy`); `Throttled` → "Too many attempts. Try
  again in 1:59."; `BiometricInvalidated` → the generated invalidation notice; `InvalidInput(reason)` → the reason with a capital first letter; `WalletExists` → "A
  wallet already exists on this device"; `Locked` → "The wallet is locked"; anything else →
  "Something went wrong. Try again.". It never includes user input.

Files: `WalletStore.kt` (state and actions), `WalletModels.kt` (Route, Tab, network preference),
`SessionGuard.kt` (lock epoch), `ErrorText.kt` (`describe`).

### 2.2 Onboarding (`ui/onboarding/*`)

Scaffold (`OnboardingScaffold.kt`, iOS `OnboardingScaffold.swift`):
- Full-bleed onboarding landscape (section 4.3) behind a card: panel colour, `BrambleRadius.xl`,
  shadow `md`.
- In midnight, the landscape is multiplied by the extension's
  `color-mix(in srgb, var(--bramble-bg) 55%, var(--bramble-text))`. The generated tokens have no
  such derived colour, so Android composes it the way iOS does: the skin's `text` at 45% over its
  `bg` (`compositeOver`, an exact sRGB mix), drawn with `BlendMode.Multiply`. The ratio is named
  once, `LANDSCAPE_TEXT_MIX` in `OnboardingScaffold.kt`, with a comment pointing to
  `styles-onboarding.ts`. No generator change.
- Each step has a back chevron top-left (label "Back"), an optional medallion (54pt elevated disc,
  24pt icon), a heavy headline with display tracking, a muted lede, and the CTA pinned to the foot
  with 28pt side padding.
- Transitions slide and fade using `BrambleEase.out` over `BrambleMotion.drawerMs`, directional
  forward and back. Compose scales every animation by the system animator setting, so they are a
  cut when it is 0 (reduced motion, and the instrumented tests via `animationsDisabled`).

Order (iOS `OnboardingFlow.swift`):
- create: welcome → passphrase → review → save phrase → confirm → all set.
- import: welcome → method → recovery → passphrase (CTA "Find your accounts") → review → all set.

The vault is written at the passphrase step. After that the back stack is replaced, so neither the
back control nor the system back gesture (`BackHandler`) goes past it (iOS `replace()`).

| Step | Copy and behaviour |
|---|---|
| Welcome | `brand_wordmark` (220dp, content description "Bramble"). "Create a new wallet" (primary), "Add an existing wallet" (secondary), lock icon + "Encrypted locally on this device". |
| Method | Medallion `wallet`. "Choose how to add your wallet" / "Bring an existing Starknet wallet into Bramble.". Rows: "Recovery phrase" / "Import 12 or 24 recovery words from another wallet." (book, enabled); "Ledger hardware wallet" (shield) and "Private key" (link), both disabled with "Coming to Bramble mobile.". |
| Recovery | "Enter your recovery phrase" / "Type each word, or paste the complete phrase into the first field. Unknown words are flagged as you go.". 3-column grid. Each cell has a right-aligned mono micro number and a mono caption input. Toggle "Use a 24-word phrase" ⇄ "Use a 12-word phrase". CTA "Continue". |
| Passphrase | "Create your vault passphrase" / "You will use this to unlock Bramble on this device.". Field "Vault passphrase", placeholder "At least 8 characters", hint "Use at least 8 characters; 12 or more is safer. This unlocks the encrypted vault on this device.". Field "Confirm passphrase", placeholder "Enter it again". Meter and weak acknowledgement below. CTA "Continue" (create) or "Find your accounts" (import). |
| Review | "Review your account" / "Confirm the derived public address, then add it to this wallet.". Card "Primary Bramble account" + short address (6…4); the card starts selected (iOS) and carries shadow `sm` while selected. Placeholder "Deriving account…". Mainnet checkbox "I understand this wallet can hold real funds on Starknet Mainnet.", shown only when network is mainnet. CTA "Add selected account". |
| Save phrase | "Save your recovery phrase" / "Write these words down in order and keep them offline.". The masked grid is blurred (6dp `Modifier.blur`, API 31+; on API 28–30 an opaque sunken cover) and hidden from accessibility until revealed; revealed words carry test tags `recovery-word-N`. `FLAG_SECURE` replaces iOS's capture detection. Toggle "Show recovery phrase" ⇄ "Hide recovery phrase" (secondary, book). Hint "Anyone with these words controls the wallet. Bramble cannot recover them for you.". Status "Reveal the phrase, save it offline, then continue.". CTA "I saved my phrase", enabled while the words are shown (iOS `.disabled(!revealed)`). |
| Confirm | "Confirm your backup" / "Enter the requested words to make sure your offline copy is accurate.". Fields "Word 3", "Word 7", "Word 11". Status "Backup confirmed." / "Enter the requested words to continue.". |
| All set | Positive 64pt disc with `accentText` check, eyebrow "Setup complete", headline "You’re all set" (U+2019), lede "Your account is ready in Bramble. Receive assets, or deploy when you’re ready.". Detail rows: lock "Vault encrypted locally on this device", shield "Recovery and signing material stay behind the wallet boundary". CTA "Open Bramble". |

Rules, every one of them taken from the core:

Passphrase meter (`PassphraseMeter.kt`): calls `passphrase_strength(value)` on each change and never
scores on its own. 4pt track, ease-out enter duration; weak → danger, fair → warning, strong →
positive. The line shows the hint while the value is invalid or the confirmation is empty, else
"<hint> · Passphrases match" (positive) or "Passphrases do not match".

Weak acknowledgement (`WeakAck.kt`): the check row (18pt box, 4pt radius) appears only when
`needs_acknowledgement`: "This passphrase is weak. I understand it is all that protects this wallet
on this device." It follows the extension's `weak-passphrase-ack.ts` `sync`: the tick is cleared
when `needs_acknowledgement` goes from true to false (the row hides), and kept while it still
applies, so a later weak value asks again. `WeakAckStateTest` pins this. Gate:
`acceptable && value == confirm && (!needs_ack || ticked)`. iOS never clears the tick, which is a
gap for `design-mobile` or `accounts` to fix on iOS (noted in section 10).

Recovery grid (`RecoveryGrid.kt`, iOS `RecoveryGrid.swift`)
- Values are normalised with `trim().lowercase()`.
- A cell is flagged when it is non-empty, fails `is_recovery_word`, and has lost focus. Flagged cells
  turn to the `dangerSoft` fill with `danger` text (fields have no edge).
- A multi-word edit in one cell is a paste: the clipboard is cleared with a write (never a read)
  and a positive toast says "Clipboard cleared" (vault-security §5.4).
- Suggestions come from `recovery_word_suggestions(prefix)` and show as a horizontal capsule row under
  the grid. The IME action (Next, Done on the last cell) applies the first suggestion and advances.
- A space in a non-empty cell advances to the next cell; Backspace in an empty cell goes back.
- A multi-word paste spreads the words from the current cell and grows the grid to 24 when needed.
- These input rules are pure (`RecoveryEntry.kt`, `RecoveryEntryTest`); the cells are `SecretField`s.
- Continue is enabled only when every cell passes `is_recovery_word` and `is_valid_recovery_phrase`
  passes for the whole phrase.
- Accessibility label is "Word N".

Backup verify: fixed positions `[3, 7, 11]`, trimmed, case-insensitive against `pendingBackup`, empty
fails. A UI gate over words already held for display (iOS `OnboardingSteps.swift`, extension
`backup-verify.ts`), pinned by the fixture's `ui` block (section 7).

### 2.3 Deliberate iOS-over-extension choices (inherited, not introduced)

| Topic | Extension | iOS and Android |
|---|---|---|
| Create order | phrase, then passphrase | passphrase, then phrase |
| Import | scan 20 indices, three account types | single "Review your account" |
| Account name | `friendlyAccountName(address)` | "Account N" (index + 1) |
| Recovery Continue gate | non-empty cells, then Krusty validates | every word valid and the phrase valid |
| Settings | no Security group | Security: Lock, Remove wallet; top group eyebrow "Accounts & networks" |
| Review card | starts unselected, 10…8 address | starts selected, 6…4 address |

### 2.4 Unlock (`UnlockScreen.kt`, iOS `UnlockView.swift`)

- Brand mark (34dp, `accentText` tint) inside a 64dp (`BrambleSize.brand`) accent circle.
- "Welcome back" / "Unlock your wallet to continue.".
- One unlabelled field, placeholder (and accessibility label) "Enter your passphrase", and an
  "Unlock" button enabled once something is typed.
- On failure, the StatusLine and an error toast both show `describe(error)`, so a wrong password gives
  "Incorrect passphrase". The password state is cleared after every attempt, successful or
  not. This is a deliberate improvement on today's Android, which keeps it after a failure.
- From `vault-security` (section 5 there): while the core throttles, Unlock is disabled and the
  status line counts down; with biometrics on, the prompt starts once per appearance and a
  secondary "Unlock with fingerprint" button offers it again; an invalidation notice shows above.

Toast (`design/Toast.kt`, hosted by `ui/Root.kt`)
- Panel card, lg radius, shadow `lg`, placed 76dp above the bottom, a polite live region.
- Tone chip: alert on dangerSoft (every current use), or check on positiveSoft.
- Fixed 3s lifetime, same as iOS. It is drawn in the activity window, not in a `Popup`, so it inherits
  FLAG_SECURE without extra work.

### 2.5 Wallet shell (`WalletShell.kt`, iOS `WalletShell.swift`)

Header: account trigger ("Accounts": 36dp Beam avatar, bold name, chevronDown, over a network dot
and `networkLabel`); explorer button ("Open in explorer", opens `explorer_account_url(network,
address)` via `ACTION_VIEW`, disabled with "Explorer unavailable on this network" when null); lock
button ("Lock wallet").

Beam avatar (`design/AccountAvatar.kt`, port of `AccountAvatarView.swift`)
- Drawn with a Compose `Canvas` on a 36-unit viewport, clipped to a circle. All geometry comes from
  `account_avatar(address)`; Kotlin only draws.
- Background rect `avatars[backgroundTone]`; head rounded rect under `withTransform { translate;
  rotate(a, 18, 18); scale }` in `avatars[wrapperTone]`; face group translated/rotated about (18, 18).
- Mouth open → stroked `M15 y c2 1 4 1 6 0` (1 unit, round cap); closed → filled
  `M13 y a1 .75 0 0 0 10 0`. Eyes: 1.5×2 rects, rx 0.75, ry 1. Ink: `face_ink_is_paper` → paper, else ink.

Body: tab content; Home has pull-to-refresh (material3 `PullToRefreshBox`, in the pinned BOM).

Floating dock (`FloatingDock.kt`)
- Panel-colour pill, full radius, shadow `md`, padding 6 × `BrambleSpace.md`, gap 12,
  `BrambleSpace.lg` above the navigation-bar inset.
- Three 44dp items (`BrambleControl.dockItem`, 24dp icons): Home, Activity, Settings. Selected:
  accentSoft fill, accent ink; others muted; press scale 0.96.

Flow screens (receive, network, appearance, reveal, remove) are pushed over the shell without the dock.
The system back gesture pops them (`BackHandler`). Routes switch with a cut, not a cross-fade, so a
locked session's screens (and their state) leave the composition at once.

### 2.6 Home (`HomeScreen.kt`)

- Hero shows "—" with content description "Portfolio total unavailable".
- Action row with tiles Send (send), Swap (shuffle), Receive (qrCode), Shield (shield). Only Receive
  is enabled. Each tile has an accentSoft fill, lg radius, minimum height `BrambleSize.actionTile`,
  a 22.5dp icon over a semibold caption, and press scale 0.97.
- "Tokens" heading plus a moreHorizontal control.
- Token rows: 40dp logo (section 4.2), symbol over `format_token_amount(raw, decimals, 4)` in
  tabular digits, "—" on the right, hairline dividers.
- Activity tab (placeholder for `portfolio-activity`): "No activity yet. On-chain transactions for this
  account, and transactions you submit from this wallet, appear here."

### 2.7 Accounts sheet (`AccountsSheet.kt`)

- Material3 `ModalBottomSheet` with `properties = ModalBottomSheetProperties(securePolicy =
  SecureFlagPolicy.Inherit)`, set explicitly, and a top radius of `BrambleRadius.xl`. Like iOS it
  has no drop shadow: the scrim separates it.
- Title "Accounts", subtitle = network name, close icon button with content description "Close".
- Rows: avatar, "Account N", and the short address in mono. The selected row sits on accentSoft with
  a check.
- Empty state: "No accounts on this network yet. Add one below.".
- Footer: "Add account" (secondary, plus icon), which calls `add_account(network)`.

### 2.8 Receive (`ReceiveScreen.kt`)

- FlowHeader "Receive" with the network pill.
- White QR card (every skin), md radius, shadow `md`, a 156dp matrix (iOS) with the extension's
  four-module quiet zone, content description "QR code for your Starknet address".
- "Your Starknet address", the full address in mono, "Network: **{label}**", and "Only send {label}
  assets to this address.".
- "Copy address" (copy icon) changes to "Copied" and stays so while the screen is open (iOS).
- Clipboard rules are in section 6.

QR encoder: `QrCode.kt` is a pure-Kotlin port of `packages/presentation/wallet-ui/src/sidepanel/shared/qr.ts`.
It uses byte mode, ECC level M, versions 1–11 and mask 0, with no dependency. It is bit-identical to
the extension, which the fixture in section 7 checks. ZXing is rejected because it adds a dependency
for about 250 lines of code and would not produce the extension's fixed mask.

### 2.9 Settings (`SettingsScreens.kt`, `SecretScreens.kt`)

Hub: eyebrow groups on lg-radius panels. Rows are 52dp with a 20dp icon in a 28dp slot and a
chevronRight, and hairlines are inset 16.

| Group | Rows |
|---|---|
| Accounts & networks | Network (globe), value = network name |
| Preferences | Appearance (settings), value "Dark"/"Light" |
| Backup & recovery | Reveal recovery secrets (lock) |
| Security | Unlock & auto-lock (shield), value "Fingerprint on"/"Passphrase only"; Lock wallet (lockKeyhole, no chevron); Remove wallet from this device (alert, danger) |

The footer shows "Bramble core {v} · Krusty KMS {v}" from `core_info()`.

Network: "Network" / "Choose where the wallet operates"; rows from `supported_networks()` show the
name and the chain id in code ("SN_MAIN", "SN_SEPOLIA"), selected on accentSoft with a check; hint
"Switching selects or derives an account on the target network.".

Appearance: "Appearance" / "How the wallet looks"; eyebrow "Theme" over a Dark/Light segmented
control (sunken track, 4dp inset, selected panel capsule with shadow `xs`). Dark is the default, no
follow-system option; persisted as `theme` = `"dark"|"light"`.

Reveal secrets: "Reveal secrets" / "Recovery phrase"; danger line (alert) "Anyone who sees these can
take your funds."; hint "Reveal only in private. Bramble will never ask you for them. They are shown
once here and never leave this screen."; field "Confirm vault passphrase" (hint "Re-enter it to
reveal. An unlocked session alone is not enough."); button "Reveal secrets" (lock) calls
`reveal_recovery_phrase(password)`. "Hide secrets", leaving the screen (`DisposableEffect`) and
`lock()` all clear the words.

Remove wallet: "Remove wallet" / "From this device only"; body "Your funds stay on Starknet, but you
will need your recovery phrase to restore this wallet."; field "Confirm vault passphrase"; danger
pill "Remove wallet" calls `delete_wallet(password)` and routes to onboarding.

## 3. Design system on Android

### 3.1 Only generated inputs

- Tokens: `BrambleTokens.generated.kt` (skins, derived colours, space, radius, control, size, type,
  weight, tracking, motion, ease, spring, shadow).
- Icons: `BrambleIconName` → `R.drawable.ic_*`.
- Brand: `brand_mark`, `brand_wordmark`.

No colour or size literal appears in UI code. The standards gate cannot see Kotlin literals, so
`SourceHygieneTest` scans every app source outside `design/` for `Color(0x`, `#rrggbb` and
`.dp`/`.sp` literals. Component geometry that the generated scale does not name (the literals the
iOS DesignSystem uses, such as the 54pt medallion) is named once in `design/BrambleLayout.kt`, each
group citing its iOS file; a generator token replaces an entry when one appears. The QR card's
white and black are `Color.White`/`Color.Black`, as iOS `.white`.

Components (`design/*.kt`, one per iOS DesignSystem file):
- `Controls.kt`: BrambleIcon, `fillPress` (iOS `FillPressStyle`), PillButton (primary, secondary,
  danger, ghost; height `BrambleSize.control`, press scale 0.98 over `pressMs`, disabled opacity
  0.5), IconButton (40dp, 0.96), BrambleField, CheckRow, SegmentedControl, Eyebrow, StatusLine.
- `SecretField.kt`: the only input for secrets (section 6.2, T4).
- `Surfaces.kt`: MenuGroup/MenuRow/MenuDivider, FlowHeader, NetworkPill, StatusDot, Medallion,
  OptionCard, DetailRow, TokenMark.
- `AccountAvatar.kt`, `Shadow.kt`, `Toast.kt`, `BrambleLayout.kt`, `BrambleTheme.kt`.

### 3.2 Shadows (the "little shadows" gap)

`Modifier.shadow(elevation)` cannot express the extension's `0 y blur rgba(0,0,0,a)`. `Shadow.kt`
adds `Modifier.brambleShadow(style: BrambleShadowStyle, shape: Shape)`:
`drawBehind` + a native `Paint` with `setShadowLayer(blur / 2, 0, y, black(alpha))` drawing the shape
outline (CSS blur = 2σ, Android radius = σ). Hardware-accelerated shadow layers work from API 28, our
minSdk.

Tier usage matches the extension:

| Tier | Used on |
|---|---|
| xs | selected segment |
| sm | selected review card (on softPress) |
| md | dock, onboarding card, QR card |
| lg | toast |

### 3.3 Shared helpers the siblings will reuse

- `shortAddress(a)` delegates to the core's `accountLabel` (the extension's 6…4 rule, no length
  guard); the accounts merge replaced android-parity's own `AddressText.kt` copy with it.
- `ui/AddressClipboard.kt` (`copy`, `clearIfExpired`) with the pure `ClipboardPolicy.kt` holds the
  clipboard rules in section 6 (T7).

Every Android screen truncates through that one wrapper (accounts.md §4).

## 4. Assets

### 4.1 Icons and brand
These are used as generated. Android adds nothing by hand.

### 4.2 Token logos

The STRK and ETH SVGs use only solid fills, `fill-rule="evenodd"`, `fill-opacity`, one `<circle>`
and nested `<g>` fill inheritance. Every one of these maps exactly onto a vector drawable
(`fillColor`, `fillType="evenOdd"`, `fillAlpha`, a circle as path data, fills resolved onto each path).
A faithful conversion is therefore possible. The comment at `scripts/mobile-assets/vectors.ts:200`
("no Android port") understates this.

Implemented: a new generator `scripts/mobile-assets/android-token-logos.ts` emits
`res/drawable/token_<64-digit address>.xml` and `design/BrambleTokenLogos.generated.kt` (map keyed
by the `0x` + 64-digit lowercase address, as iOS), wired by two additive lines in `mobile-assets.ts`
and one `export` on `vectors.ts`'s existing `pathData` (reused for the ETH circle, not re-derived);
`tests/conformance/mobile-generated.test.ts` byte-compares them through the renderer's file list
with no test change. Any SVG feature without an exact drawable form (gradient, clip path,
transform, stroke, group opacity) fails generation rather than being dropped.
- `TokenMark` uses the logo when one exists. Otherwise it shows the letter badge (initial, bold body,
  muted ink, sunken 40dp circle), which the extension also uses for unknown tokens.

This touches `scripts/`, which `design-mobile` may also edit, so the work is in a new file. If the
orchestrator rules it out of scope, reverting those three script edits and the three generated
files returns Android to the letter badge, which `TokenMark` still uses for unknown tokens.

### 4.3 Onboarding landscape

Nothing is committed. `app/build.gradle.kts` gains a `Copy` task `copyOnboardingLandscape` from
`../../apps/extension/public/brand/onboarding-landscape.webp` to
`build/generated/bramble-res/drawable-nodpi/onboarding_landscape.webp`, registered with
`sourceSets["main"].res.srcDir(...)` and wired before `preBuild`. A missing source fails
configuration (no fallback image). `build/` is already git-ignored and excluded from the standards
gate. A sibling task `copyParityFixture` copies `mobile/core/tests/fixtures/extension-parity.json`
into generated `androidTest` assets the same way.

## 5. UniFFI surface

**No new UniFFI surface.** Android uses only what `mobile/core/src/lib.rs` already exports, through
the Kotlin bindings that `mobile/scripts/build-core-android.sh` generates into
`app/build/generated/uniffi` (package `org.bramble.core`, never committed):

```rust
fn core_info() -> CoreInfo;
fn supported_networks() -> Vec<NetworkInfo>;
fn is_valid_recovery_phrase(phrase: String) -> bool;
fn is_recovery_word(word: String) -> bool;
fn recovery_word_suggestions(prefix: String) -> Vec<String>;
fn passphrase_strength(value: String) -> PassphraseStrength;
fn account_avatar(address: String) -> AccountAvatar;
fn explorer_account_url(network: NetworkId, address: String) -> Option<String>;
fn format_token_amount(raw: String, decimals: u8, max_fraction: u8) -> Result<String, CoreError>;
fn rpc_chain_id_request(..) / rpc_verify_chain_id(..) / rpc_balance_request(..) / rpc_parse_balance(..);
impl WalletCore { new(data_dir, clock), status, create_wallet, import_wallet, unlock, lock, accounts,
                  add_account, reveal_recovery_phrase(password), delete_wallet(password),
                  // added by vault-security, used since the merge:
                  security_status, session_remaining_ms, enable_biometric_unlock,
                  disable_biometric_unlock, unlock_with_biometric, reconcile_biometric_domain,
                  biometric_invalidated }
```
(Argument lists indicative; the generated bindings are authoritative.)

What crosses, and what never does:
- **Host to core:** the vault passphrase (create, unlock, reveal, delete), the imported phrase once
  at import, and public inputs such as addresses, prefixes and raw balances.
- **Core to host:** the recovery phrase only at creation and on password-rechecked reveal (SCOPE.md),
  plus public data: addresses, public keys, class hashes, avatar geometry, strength bands, URLs and
  formatted amounts.
- **Never crosses:** private keys, the BIP-39 seed, vault keys and KDF output, STRK20 viewing keys, or
  any Nostr secret. Android adds no call that could carry them, and `sign_hash` stays unused by the UI.

## 6. Storage, security, threat model

### 6.1 Persisted state
| Item | Where | Secret | Migration |
|---|---|---|---|
| Vault (`vault.json`) | `noBackupFilesDir/vault`, written by the core with an atomic rename | sealed | owned by core schema; none here |
| `network` | SharedPreferences `bramble` | no | existing key, same values |
| `theme` | same prefs | no | new key; absent means dark |

No other state is persisted. The route model is in memory only, so the old `Route` enum needs no
migration.

### 6.2 Threats and mitigations (all inside `mobile/android`)

| # | Threat | Mitigation | Test |
|---|---|---|---|
| T1 | Screenshots, screen recording, the Recents thumbnail showing the phrase | `FLAG_SECURE` on the activity window (kept). Sheets and dialogs pass `SecureFlagPolicy.Inherit` explicitly. No `Popup` is used for secrets. | `SecurityTest.flagSecureIsSet`; `SourceHygieneTest` fails on `SecureOff`, `Popup(` and `clearFlags(` |
| T2 | Vault copied off-device by Auto Backup or device transfer | Vault in `noBackupFilesDir`; `allowBackup=false`, `fullBackupContent=false`, extraction rules exclude every domain (kept) | `SecurityTest.vaultLivesInNoBackupFilesDir`, `SecurityTest.backupIsOff` |
| T3 | Unlocked session left behind the lock screen or in Recents, including by a core call still running when the app leaves the foreground | `ProcessLifecycleOwner.onStop` → `store.lock()` (kept): wipes `pendingBackup`, accounts and route state on the main thread, locks the core on `Dispatchers.Default`, and moves the lock epoch on so a late unlock, reveal or create result is dropped and the core re-locked (section 2.1). Reveal words live only in the reveal screen, which leaves the composition on lock. | `LockOnBackgroundTest`: press Home then return to "Welcome back"; start an unlock, a reveal and a create, lock before they finish, and assert the core is LOCKED, the route is LOCKED and no words are held; background mid-onboarding and recover the phrase through Reveal |
| T4 | The keyboard learns phrase words or passphrases | One `SecretField` used by every secret input. Details below. | `SecretFieldTest` asserts the full `EditorInfo.inputType` (class bits included) and `imeOptions` |
| T5 | An autofill service captures or offers the passphrase | `window.decorView.importantForAutofill = IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS` in `MainActivity`; `SecretField` sets the same on its view | `SecurityTest.blocksAutofillAndObscuredTouch`, `SecretFieldTest.autofillIsExcluded` |
| T6 | Tapjacking over Reveal, Remove, Unlock | `View.filterTouchesWhenObscured = true` on the decor view (a `ViewGroup` drops filtered events before dispatching to children), and `window.setHideOverlayWindows(true)` on API 31+ (needs `HIDE_OVERLAY_WINDOWS`, a normal permission) | `SecurityTest.blocksAutofillAndObscuredTouch` |
| T7 | Clipboard leaks the address or wipes someone else's clip | Only the public address is ever copied, labelled "Starknet address". It is public, so the clip is not marked `EXTRA_IS_SENSITIVE` and Android 13+ shows its usual preview. Expiry is **best-effort**, not iOS's guaranteed two minutes: from API 29 an app can read the clipboard only while it has focus, and copying then switching apps both backgrounds and locks Bramble. So the store's scope clears the clip after 120 s if Bramble is still in front, and otherwise `MainActivity.onWindowFocusChanged` clears it the next time Bramble has focus once 120 s have passed. It clears only if the clip is still ours: same label and the system timestamp recorded at copy time, read from `primaryClipDescription` so another app's clip content is never read. The phrase is never copyable: `SecretEditText` removes copy, cut and share from its selection menu. | `ClipboardPolicyTest` (JVM: expired and ours only); `ReceiveTest` (the clip holds exactly the address, with our label) |
| T8 | A hostile RPC endpoint exhausts memory | `RpcClient` reads at most 64 KiB (`MAX_RESPONSE_BYTES`) and fails as soon as the body is longer, before handing the bytes to the core. HTTPS only (kept). | `RpcClientBoundTest` (JVM, fake stream) |
| T9 | Secrets in logs or crash reports | No logging anywhere in the app sources. `describe()` never interpolates input. Release keeps minify on. | `SourceHygieneTest.nothingLogs` |
| T10 | Secret strings lingering in Compose state or reaching the saved-instance Bundle | The password state is cleared after every attempt. Phrase and reveal words are cleared on dispose and on lock. `rememberSaveable` is never used. `SecretEditText` is created with no view id and `isSaveEnabled = false`, overrides `getFreezesText()` (hard-wired to true on `EditText`) to false, and returns the empty state from `onSaveInstanceState`, so neither `saveHierarchyState` (which Compose's `AndroidView` feeds into its saveable registry) nor a direct save captures the text; its `Editable` is cleared when it leaves the composition. | `SourceHygieneTest` (no `rememberSaveable` anywhere); `SecretFieldTest.typedTextStaysOutOfSavedState` (no id, save disabled, freezes off, `saveHierarchyState` of the field and of a saving parent holds no typed text) |

T4 in detail. `SecretField` wraps a platform `EditText` (`SecretEditText`) through `AndroidView`,
because Compose foundation 1.7 in the pinned BOM does not expose
`IME_FLAG_NO_PERSONALIZED_LEARNING`. It is the app's only secret input: `vault-security`'s
`SecretKeyboard` (an `InterceptPlatformTextInput` around Compose fields) was folded into it at
the merge, and `SourceHygieneTest.secretsGoThroughSecretField` keeps any other text field or
`EditText` out. The field sets (`SecretInput`):
- `TYPE_CLASS_TEXT or TYPE_TEXT_VARIATION_PASSWORD or TYPE_TEXT_FLAG_NO_SUGGESTIONS` for
  passphrases.
- `TYPE_CLASS_TEXT or TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or TYPE_TEXT_FLAG_NO_SUGGESTIONS` for
  phrase words, so they stay readable. The class bits are always set: variation and flag bits only
  apply inside a class, and a class of 0 is `TYPE_NULL`, where an IME may fall back to a raw mode
  that ignores the no-suggestions hint.
- `imeOptions |= IME_FLAG_NO_PERSONALIZED_LEARNING | IME_FLAG_NO_EXTRACT_UI`.
- `importantForAutofill = NO_EXCLUDE_DESCENDANTS`.
- The T10 save-state hardening above.

Its content description is the field's label (or placeholder when unlabelled), which is what a
screen reader announces and what the instrumented tests look up with Espresso. It is styled from
the tokens inside BrambleField's frame.

### 6.3 Residual risk

Since the merge with `vault-security`, Android has the Keystore-held biometric wrap secret, the
core's persisted back-off and idle lock, and the Security screen (`ui/wallet/SecurityScreen.kt`),
all uncompiled; see `docs/vault-security.md`. Still open: Kotlin `String`s cannot be wiped (an
`EditText`'s `Editable` is cleared, not zeroed), and UniFFI's lowering buffers are freed unwiped.
- Backgrounding in the middle of onboarding clears `pendingBackup` after the vault exists. The user
  recovers through Reveal secrets. This is the same as iOS, and a test pins it (section 8).
- Before a vault exists, backgrounding restarts onboarding at welcome: `lock()` bumps
  `onboardingGeneration` and `Root` keys the flow on it, so a typed recovery phrase or passphrase
  is disposed (and its `EditText` cleared). This is stricter than iOS, which keeps that state.
  `LockOnBackgroundTest.preVaultBackgroundDropsPhrase` pins it.
- The vault is written before the backup is confirmed (same as iOS; the extension verifies first).
  After a lock mid-backup nothing prompts the user to finish it; recorded in SCOPE.md known limits.

Biometric unlock moves only the wrap secret W across FFI (host to core); SCOPE.md records it.

## 7. Parity fixtures and 8. Test plan

Moved to [android-parity-testing.md](android-parity-testing.md) (same section numbers): the
fixtures Android checks, the toolchain needed to compile and run it (the code is uncompiled on
this machine), the pinned Gradle wrapper, test dependencies, JVM unit tests, and the instrumented
tests that mirror the iOS XCUITests.

## 9. Changes outside `mobile/android` (need orchestrator sign-off)

1. Done: `scripts/mobile-assets/android-token-logos.ts` (new), two additive lines in
   `scripts/mobile-assets.ts`, and `export` on `pathData` plus a corrected comment in
   `scripts/mobile-assets/vectors.ts` (section 4.2). Reverting them returns Android to the letter
   badge.
2. Not needed: `".jar"` in `BINARY_EXTENSIONS` (section 8.1); optional cleanup.
3. Optional: a conformance check that the QR fixture is fresh (section 7).

## 10. Out of scope or blocked

- Blocked on nothing in krusty-kms 0.11.0 (all displayed values are bramble-core code; only `kms.rs` calls krusty); compiling and running are blocked on the toolchain (section 8).
- Deferred to siblings: friendly names, the 10…8 review address and unselected review card
  (`accounts`/`design-mobile`); discovery (`accounts`); account-type chooser, multisig, Nostr
  (`accounts`/`nostr-multisig`); fiat and activity (`portfolio-activity`); send, swap, shield
  (`transactions`); Keystore, biometrics, back-off and idle lock landed with `vault-security` at the merge.
- When those land in the core or generator, Android picks them up via the bindings (seams: section 1).
- iOS gap, for `design-mobile` or `accounts`: the iOS weak-passphrase tick is never cleared when the
  acknowledgement stops applying; Android follows the extension (section 2.2).

## 11. Review resolutions

| Must-fix | Resolution |
|---|---|
| Lock on background vs running core calls | Lock epoch in the store; late results dropped and the core re-locked; `core.lock()` off the main thread; `LockOnBackgroundTest` covers unlock, reveal and create (sections 2.1, 6.2 T3) |
| `EditText` saved-instance state | No id, `isSaveEnabled = false`, `getFreezesText()` overridden, empty `onSaveInstanceState`; `SecretFieldTest` asserts it (T10) |
| Word `inputType` without class bits (both reports) | `TYPE_CLASS_TEXT` always set; `SecretFieldTest` asserts the full value and the class nibble (T4) |
| `pm clear` and the `network` argument | Orchestrator with `clearPackageData=true`; argument dropped (sections 2.1, 8.2, 8.4) |
| Compose finders cannot type into `EditText` | Espresso added; fields found by content description after scrolling by test tag (sections 8.2, 8.4) |
| Weak acknowledgement clearing | Follows the extension's `sync`; iOS gap noted (sections 2.2, 10) |
| Clipboard expiry and `EXTRA_IS_SENSITIVE` | Best-effort expiry on focus, ours-only check via the clip description; not marked sensitive, preview shown (T7) |
| Midnight multiply colour | Composed from `bg` and `text` at the named 45% ratio, as iOS; no generator change (section 2.2) |
| Stale balances after a network or account change (review 2) | `balances` carry the network and address they were read for; `switchNetwork`, `addAccount` and `select` clear them, a read that returns for another view is dropped, and `amount()` shows nothing for a view it was not read for |
| Live mainnet test "refused under CI" only by hand (review 2) | `build.gradle.kts` forwards the host `CI` variable as the `ci` instrumentation argument; the live test takes no screenshots |
| Onboarding secrets survive a pre-vault lock (review 2) | Flow keyed on `onboardingGeneration` (section 6.3) |
