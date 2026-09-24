# Vault security — test plan

Companion to [vault-security.md](vault-security.md); section numbers are kept.

### 8.1 Rust (`cargo test --locked`, new files under `core/tests/`, each under 500 lines)

- `migration.rs`: an **old** v1 file (committed fixture made by today's core with the published
  test phrase) unlocks, migrates, writes v2 and unlocks again; a v1 file with the legacy 310k count
  migrates to 600k; a failed write leaves v1 intact and the unlock still succeeds;
  the migration step is deterministic given fixed randomness (golden JSON); **current** v2
  round-trips; **invalid**: unknown `format`/`version`, unknown fields, lineage mismatch,
  wrong-length slot, swapped payload/slot between two vaults, v2 container carrying a v1
  payload, truncated file — each is a `Storage` error with no partial state.
- `biometric.rs`: enable → lock → unlock with W; wrong W → `BiometricInvalidated` and slot gone;
  W of the wrong length → `InvalidInput`; a `State` mismatch or `NotEnrolled` locks and drops the
  slot; `Unavailable` (lockout) keeps the slot and the session; a slot without a domain (Android)
  survives reconciling;
  disable works while locked; `add_account` after a biometric unlock re-seals the payload only
  (passphrase slot bytes unchanged); reveal after a biometric unlock still needs the passphrase.
- `backoff.rs` (fake `HostClock` with a separate fake wall clock that the core never reads): the
  1–4 free / 30 s doubling / 1 h cap schedule as a table; the counter persists across a fresh
  `WalletCore` over the same directory; the counter is written before the KDF (a unit test in
  `security.rs` reads the file between `begin_attempt` and the KDF); success resets; a wall-clock
  jump forward or back changes nothing; a new boot id and a monotonic value below the stamp each
  restart the full delay; a malformed `security.json` becomes 5; all four entry points share one
  counter; a throttled call never reads `vault.json`; **concurrent** wrong-passphrase `unlock`,
  `reveal` and `delete` calls from many threads leave a stored count equal to the number of KDF runs
  (every `WrongPassword` result), and the rest are `Throttled`.
- `auto_lock.rs`: expires after `IDLE_LOCK_MS` of monotonic time; `accounts()`/`status()` do not
  renew; `sign_hash`/`add_account` do; a monotonic value below `last_activity` or a new boot id
  locks instead of panicking or extending; a wall-clock jump has no effect; an expired session is
  dropped (checked through `status()`).
- `ffi_surface.rs`: no exported method returns secret-shaped types (above).
- The existing `wallet.rs`/`parity.rs` suites pass unchanged except for the constructor clock.

### 8.2 Swift unit (`BrambleTests`, on "Bramble Workflow")

`CoreBridgeTests`: `Throttled` maps to the countdown text; `HostClock` bridge; the wrap secret
buffer is zeroed after the call (it is inspected after `withUnsafeMutableBytes`). `ThemeTests`: an
unset theme and a stored `"system"` both resolve to `.dark` / midnight. `CopyTests`: the generated
security copy table is present and "Incorrect passphrase" matches the extension string.
`KeychainSlotTests`: the item is created with `.biometryCurrentSet` + `ThisDeviceOnly` +
non-synchronisable (attributes read back), and deleted on `NoWallet`.

### 8.3 XCUITest (`BrambleUITests`, "Bramble Workflow" only, never "iPhone 16")

Uses the repository's published test phrase and a throwaway passphrase. No network is needed.
1. Onboard → Settings → "Unlock & auto-lock" → On → passphrase → Face ID enrolled and
   matched from the test runner via `xcrun simctl spawn "Bramble Workflow" notifyutil -s
   com.apple.BiometricKit.enrollmentChanged 1` / `-p com.apple.BiometricKit_Sim.pearl.match`
   (Simulator-only notification names; to verify on the installed Xcode) → locked by
   background → the unlock screen starts Face ID → a matching face opens Home.
2. A non-matching face → the passphrase field is still usable **and the slot is kept**:
   "Unlock with Face ID" is still offered, and Settings still shows it on.
3. Five wrong passphrases → countdown shown, button disabled; relaunch the app → countdown still
   shown (persistence).
4. Toggle enrolment off/on → foreground → locked, biometrics shown as off, invalidation copy shown.
5. Reveal screen: no "Copy" button exists; words masked until tapped; with Face ID on, reveal still
   asks for the passphrase.
6. Import: paste a phrase into the first field → the clipboard is empty afterwards.
7. Fresh install → Appearance shows Dark selected.
Idle expiry is covered in Rust with a fake clock rather than a 30-minute UI wait. A debug-only
launch argument that shortens `IDLE_LOCK_MS` is **rejected**, because it would add a
production-reachable lever. The host timer is driven by `session_remaining_ms()`.

### 8.4 Android

Written against the generated Kotlin bindings, **uncompiled and unrun** (no SDK); they join CI
with SCOPE.md Phase 1.1. Instrumented: `CoreBridgeTest` (the fifth wrong passphrase starts a
delay and a correct one is then refused as `Throttled`; the biometric slot opens only with its
wrap secret and a wrong one drops it) and `SecretFieldTest` (the one secret input's full input
type, IME flags, autofill exclusion and saved state). JVM: `ErrorTextTest` (incorrect, throttled
and invalidation copy), `RecoveryEntryTest` (what counts as a phrase paste) and
`SourceHygieneTest.secretsOnlyGoThroughSecretField`. The biometric prompt, Keystore invalidation
and the Security screen have no Android UI test yet; the iOS `SecurityFlowTests` are the model.

### 8.5 Parity fixtures (`bun run mobile:parity` / `mobile:assets`, checked in `bun run check`)

- `core/generated/policy.json`: `idleLockMs` from the exported `DEFAULT_TTL_MS`,
  `minPassphraseLength` from `MIN_VAULT_PASSPHRASE_LENGTH`, and `kdfIterations` from
  `KDF_ITERATIONS`. The Rust constants are asserted equal to it.
- `extension-parity.json` gains `vault.passwordSlot`: a DEK sealed by the **extension's own**
  `EncryptedStore` under scope `bramble.mobile.dek.v1`, which Rust must open. This proves the
  passphrase slot is byte-compatible.
- Copy: `unlockCopy` (from `gate-views.ts`), `revealCopy` (from `reveal-ui.ts`) and
  `incorrectPassphrase` (from `unlock-errors.ts`) are exported to Swift and Kotlin. The **NEW**
  mobile strings come from `scripts/mobile-assets/security-copy.ts`, the one source for both
  platforms.
- `extension-parity.json` gains `theme.default = "dark"` (from `appearanceFlow`'s resolution).

