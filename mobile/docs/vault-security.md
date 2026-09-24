# Vault security — design

Status: implemented on `feature/mobile-wallet` (Rust core and iOS verified; Android written against
the generated Kotlin bindings but uncompiled). Revised 2026-09-24 after review: backoff and idle
lock run on a monotonic, boot-scoped clock (§4.4); passphrase attempts are serialised under one
attempt mutex (§4.1); renewal follows the extension exactly, with no `record_activity` (§4.2);
ordinary biometric failures keep the slot (§4.3). This document covers SCOPE.md Phase 1.3 plus
the auto-lock, screen-protection and settings work that comes with it.

## 0. What the extension actually has (read this first)

The brief asks mobile to "mirror" extension rules. For most items the extension has no such rule:

| Brief item | Extension today | Consequence for mobile |
| --- | --- | --- |
| Biometric unlock / wrapped DEK | None. PBKDF2 key seals the vault directly (`encrypted-store.ts`) | New behaviour, new copy, new vault version. None of it can be generated from the extension |
| Brute-force backoff | None. Only KDF cost; error string `Incorrect passphrase` | New core rule. Only the error copy is shared |
| Idle auto-lock | Fixed 30 min rolling window (`DEFAULT_TTL_MS`, private), only user-started operations renew it, ceiling 8 h, **no setting** | Mobile uses the same fixed window. No picker (see §9, D2) |
| Security settings | `securityFlow` lists links only; no lock controls | New rows reuse existing components; copy is new |
| Screen protection | CSS blur `.is-masked` + "Tap to show" | Keep mask-until-tapped; OS protections are mobile-only |
| Clipboard | **Copies** the phrase, with a wipe after 60 s | Mobile deliberately drops the copy button (§5.4) |
| Theme default | Dark when unset or legacy `system` | Already true on mobile: iOS `@AppStorage` defaults to `.dark` and an unknown raw value (for example `system`) falls back to it; Android `BrambleTheme(light = false)`. A Swift test pins it (§8.2) |

Every "new copy" string below is marked **NEW**. These strings have no extension source, so they
cannot be generated. They are written once in `scripts/mobile-assets/` as a mobile-only copy
table, and the generator emits them into Swift and Kotlin. Nobody retypes them per platform.
Strings the extension already has are imported from its TypeScript, never retyped.

## 1. Goals and non-goals

Goals: (1) opt-in biometric unlock that never replaces the passphrase; (2) wrong-passphrase
backoff that survives restarts and is enforced by the core; (3) lock on background, after 30 idle
minutes, and on any biometric change; (4) phrase and secret screens protected from screenshots,
recording, the app switcher, keyboards, autofill and the clipboard; (5) a Security settings screen.

Out of scope: transactions, privacy pool, cloud backup, wiping the wallet after N failures (§9, D4),
a device-passcode fallback, and changing the passphrase (a separate feature; it is cheap with the
DEK design and the surface leaves room for it).

## 2. Key design

### 2.1 Choice

A random 32-byte **data-encryption key (DEK)** seals the vault payload with AES-256-GCM. The DEK is
wrapped by up to two **slots**:

- **Passphrase slot** (always present): the extension's EncryptedEnvelope v3 (PBKDF2-SHA-256
  600k → AES-256-GCM, AAD `scope\0lineage\0commit`), sealing the DEK under scope
  `bramble.mobile.dek.v1`. This reuses `vault::SealingKey` / `vault::open` unchanged, so it
  stays byte-compatible with the extension envelope and its tamper tests.
- **Biometric slot** (optional): AES-256-GCM of the DEK under a 32-byte **wrap secret W**, with AAD
  `bramble.mobile.biometric.v1\0lineage\0slotId\0domain`, so the stored enrolment-domain hash
  is authenticated too (an edited or blanked `domain` stops the slot opening). W is held by the
  platform behind biometrics.

All vault cryptography stays in Rust, using the crates `bramble-core` already pins (`aes-gcm
=0.11.1`, `pbkdf2 =0.13.0`, `sha2 =0.11.0`, `getrandom =0.4.3`). **No new Rust dependency.**

### 2.2 What crosses the FFI and why this is the minimum

| Secret | Crosses FFI? |
| --- | --- |
| Private keys, viewing keys | Never (unchanged) |
| Recovery phrase | Only at creation and on a passphrase-rechecked reveal (unchanged) |
| DEK | **Never**. Generated, wrapped, unwrapped and zeroized in Rust |
| Passphrase KEK | **Never** (derived in Rust as today) |
| Passphrase | Host → core only (unchanged) |
| Wrap secret W | **Host → core only**: once when biometrics are turned on, and on each biometric unlock. Never core → host |

W is equivalent to the vault key for anyone who also holds `vault.json`. It is a new crossing, so
SCOPE.md's "Security posture" and the key-boundary sanction list must name it explicitly. It
cannot be avoided: on both platforms the biometric hardware releases a secret into app memory
(iOS `SecItemCopyMatching` / `SecKeyCreateDecryptedData` return `Data`; Android `Cipher.doFinal`
returns `ByteArray`). No platform lets that secret go straight to native Rust without passing
through Swift or Kotlin. The design keeps that exposure as small as it can:

- The host **generates** W with its platform CSPRNG (`SecRandomCopyBytes` / `SecureRandom`) and
  seals it in hardware. W only ever flows into the core, so the core never has to return a secret.
- W is not the DEK. If the biometric slot is removed, W is useless, and the DEK never exists
  outside Rust.
- The host keeps W in one owned buffer (never a `String`): on iOS a `WrapSecret` that copies the
  Keychain reply straight out of its `CFData` (never bridged to `Data`, whose copy-on-write
  storage would leave copies a wipe cannot reach) and zeroes that buffer in place with
  `resetBytes(in:)` as soon as the core call returns; on Android the decrypted `ByteArray`,
  `fill(0)`. The core moves it into `Zeroizing<Vec<u8>>`.
- Not wiped, and listed in SCOPE.md's known limits: the Keychain's immutable reply `CFData` (and
  securityd's reply buffer behind it), `javax.crypto`'s internal buffers on Android, and UniFFI's lowering
  copies (the foreign-side serialisation buffer and the `RustBuffer` the core lifts `Vec<u8>` out
  of). UniFFI 0.29.5 exposes no hook to zero a lifted `RustBuffer`; closing that needs an upstream
  UniFFI change or a hand-written byte-pointer FFI entry point for W.

Rejected: **storing the passphrase behind biometrics** (common in wallets). It is simpler but puts
the passphrase in host memory on every unlock and runs PBKDF2 each time. **Wrapping the DEK
natively** puts the vault key itself in Swift or Kotlin memory.

### 2.3 iOS: how W is held

A Keychain `kSecClassGenericPassword` item (service `org.bramble.wallet.biometric`, fixed
account `wrap-secret.v1`; the slot id binds the core's AAD, and a stale item simply fails GCM) with `SecAccessControlCreateWithFlags(kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
.biometryCurrentSet)` and `kSecAttrSynchronizable = false`. On a real device the Secure Enclave
enforces the biometric check on this access control, and the `.biometryCurrentSet` flag makes the
item unreadable after any change to enrolled faces or fingers. There is no passcode fallback
because the flag set does not include `.devicePasscode`.

Why not Secure Enclave P-256 ECIES around W: it gives W no stronger protection (the plaintext W
still lands in Swift). It also fails on the Simulator (`kSecAttrTokenIDSecureEnclave` is
unavailable there), which would need a second code path and would leave the XCUITest suite unable
to cover the feature. ECIES stays open as a later hardening that needs no core change (§9, D1).

Reads first run an explicit `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`
and pass that context to `SecItemCopyMatching`, so LAError codes map cleanly to "keep the slot"
and the simulator shows a real prompt. Enabling also runs one evaluation first.

`NSFaceIDUsageDescription` is added through `project.yml` (**NEW** copy: "Bramble uses Face ID to
unlock your wallet instead of typing your passphrase."). A leftover Keychain item from an earlier
install (Keychain survives uninstall) is deleted when `status()` returns `NoWallet`.

### 2.4 Android: how W is held (uncompiled — no SDK on this machine)

A Keystore key `bramble.biometric.v1`: AES-256-GCM, `PURPOSE_ENCRYPT|DECRYPT`,
`setUserAuthenticationRequired(true)`, `setInvalidatedByBiometricEnrollment(true)`,
`setIsStrongBoxBacked(true)`. On API 30+ add `setUserAuthenticationParameters(0,
AUTH_BIOMETRIC_STRONG)`. On `StrongBoxUnavailableException`, retry backed by the TEE (still
hardware; the Security screen shows which one is in use). Unlock uses the platform
`android.hardware.biometrics.BiometricPrompt` (API 28+) with a `CryptoObject(cipher)` limited to
`BIOMETRIC_STRONG`. There is **no new dependency** (`androidx.biometric` is not needed). The
ciphertext of W and its IV live in `noBackupFilesDir/biometric-w.bin`, written by the host.
`KeyPermanentlyInvalidatedException` means enrolment changed (§4.3).

## 3. Storage and migration

### 3.1 Vault file v2 (`vault.json`, still one file, still write-then-rename)

```json
{
  "format": "bramble.mobile.vault",
  "version": 2,
  "lineage": "<32 lowercase hex, shared by every part of this vault>",
  "passwordSlot": { "…extension EncryptedEnvelope v3, scope bramble.mobile.dek.v1, plaintext {\"dek\":\"<b64 32B>\"}…": "" },
  "biometricSlot": null | { "id": "<32 hex>", "iv": "<b64 12B>", "data": "<b64 48B>",
                            "domain": "<64 hex SHA-256 of host biometric domain state, or empty>" },
  "payload": { "scope": "bramble.mobile.payload.v2", "iv": "<b64 12B>", "commit": "<b64 16B>",
               "data": "<b64 AES-256-GCM(DEK, VaultPayload JSON)>" }
}
```

- Payload AAD: `bramble.mobile.payload.v2\0lineage\0commit`, following the envelope's pattern.
  Every payload write uses a fresh IV and commit and leaves the DEK unchanged, so adding an
  account costs no PBKDF2.
- The passphrase slot is sealed again only on migration or a passphrase change.
- The container JSON is `deny_unknown_fields`. Every lineage must match, base64 fields have exact
  lengths, and a slot of the wrong length, a `version` other than 2 or an unknown `format` fails
  closed as `Storage { "vault file is invalid" }`.
- Removing `biometricSlot` needs no key, so a "biometric changed" event can drop it while the
  wallet is locked. Anyone able to delete it can only turn biometrics off. Adding a slot needs the
  DEK.
- `VaultPayload.version` becomes 2 (same fields). `open_session` accepts v2 payloads only inside
  a v2 file.

### 3.2 Migration v1 → v2 (single adjacent step, deterministic)

The mobile core has no migration framework. It gains a `migrations.rs` with one table,
`VAULT_MIGRATIONS: [(from, step)]`, following `packages/platform/vault/src/schema/migrations.ts`:
exactly one adjacent step per version, and a pure step function `(v1 plaintext, fresh DEK, fresh
IVs/commits) → v2 container`. Randomness is passed in, never drawn inside the step, so tests can
fix it.

- **Trigger:** the first successful passphrase unlock of a v1 file (the v1 file must be opened
  with the passphrase, so the migration cannot run earlier). A v1 file has no biometric slot, so
  biometric unlock cannot run before migration.
- **Order:** open v1 → validate payload as today → build v2 in memory → re-open v2 in memory with the
  same passphrase (proves it round-trips) → write `vault.json.tmp`, fsync, rename. If anything
  fails, v1 stays on disk and the unlock still succeeds, with the session's migration marked
  pending. The next unlock retries.
- **Detection:** a top-level `format` key means a container. An `EncryptedEnvelope` (which has
  `cipher`/`kdf`, no `format`) means v1. Anything else fails closed.
- Legacy `310_000` iterations inside a v1 envelope are accepted as today and migrate to 600k.
- A v2 file opened by an older core fails as `Storage` (it is not an envelope). That is expected
  and cannot corrupt anything, because nothing writes over a file it could not open.

### 3.3 Security state file (`security.json`, next to `vault.json`)

```json
{ "version": 1, "failedAttempts": 0, "bootId": "<host boot identifier>", "monotonicAtFailureMs": 0 }
```

`monotonicAtFailureMs` is read from the host's monotonic clock (§4.4), never the wall clock, and is
only meaningful within the boot named by `bootId`.

Plain JSON, write-then-rename, same directory protection (iOS `FileProtectionType.complete` +
excluded from backup; Android `noBackupFilesDir`). It is not encrypted and has no MAC, because
there is no key available after a failed attempt. That is acceptable: an attacker who can edit
app-container files can already copy `vault.json` and guess offline, so the counter only defends
against guessing through the device's own UI (§6, T3). Missing file means zero attempts. A
malformed file or unknown version is **not** reset to zero: it is rewritten as
`failedAttempts = 5` stamped with the current boot and monotonic time, which fails closed at the
first backoff step without locking the owner out for long. The file is deleted with the vault.

The host's settings (not secret, not security-critical) stay where they are: the theme in
`@AppStorage`/`SharedPreferences`. Whether biometrics are on is read from the vault
(`biometricSlot != null`), never from a host preference, so the UI cannot claim biometrics are on
when they are not.

## 4. Core behaviour

### 4.1 Backoff (enforced in the core, before any PBKDF2)

Shared by every passphrase entry point: `unlock`, `reveal_recovery_phrase`, `delete_wallet`,
`enable_biometric_unlock`.

- Attempts 1–4 fail with no delay (allowance for typos).
- From the 5th failure: delay `= 30 s × 2^(n−5)`, capped at **1 hour** (reached at n = 12).
  Delays: 30 s, 1 m, 2 m, 4 m, 8 m, 16 m, 32 m, 1 h, 1 h, …
- **One attempt at a time.** Every passphrase entry point takes a dedicated *attempt mutex*
  (separate from the session mutex, so `lock()` is never held up behind the KDF) and holds it for
  the whole attempt: read `security.json` → apply the throttle → read `vault.json` → write
  `failedAttempts + 1` with the current monotonic stamp (temp file, `fsync`, rename) → PBKDF2 →
  reset or keep. Two concurrent calls (unlock from the lock screen and a reveal sheet, repeated
  taps sent to background tasks) therefore cannot both read `n`, both pass the throttle and both
  run the KDF: the second one sees `n + 1`.
- **Pessimistic write:** the counter is incremented and persisted *before* PBKDF2 starts, and reset
  to zero only after the passphrase is proven correct. Killing the app during the ~0.5 s KDF
  therefore cannot get a free guess. If the counter cannot be written, the attempt is refused
  (`Storage`) rather than run uncounted. A missing or unreadable vault is reported before the
  counter moves, because no guess was possible.
- While throttled, the call returns `CoreError::Throttled { retry_after_ms }` without reading
  `vault.json`.
- **Clock rules:** the delay counts down only in monotonic time (§4.4), which the user cannot set.
  If the stored `bootId` differs from the current boot, or the monotonic clock is below the stored
  stamp, the core re-stamps with the current reading and the **full** delay starts again. A
  wall-clock change never shortens the delay, and a reboot costs the attacker time and gains
  nothing (§6, T4).
- Biometric unlock is allowed while the passphrase is throttled (the OS rate-limits biometrics and
  Face ID drops to the passcode, which the Keychain access control refuses). A biometric success
  does **not** reset the passphrase counter; only a correct passphrase does.
- Wrong-W biometric failures are not counted: W is 256-bit and cannot be guessed. A GCM failure on
  the biometric slot means the slot is stale or tampered, so the core drops the slot and returns
  `BiometricInvalidated`.

### 4.2 Idle auto-lock (enforced in the core)

- `IDLE_LOCK_MS = 1_800_000`, generated from the extension (`DEFAULT_TTL_MS` is exported from
  `apps/extension/src/background/runtime/session.ts` and emitted by
  `scripts/generate-mobile-assets.ts` into `core/generated/policy.json`, with a drift test in
  `tests/conformance/mobile-generated.test.ts`; a Rust test asserts the core constant equals it).
- The session holds `last_activity`, a monotonic reading (§4.4). Every session method first
  computes `now.checked_sub(last_activity)`. If the boot changed, the subtraction underflows (the
  clock went backwards), or the result exceeds `IDLE_LOCK_MS`, it drops the session (zeroizing it)
  and returns `Locked`. `status()` runs the same check. Nothing on this path can panic.
- **Renewal follows the extension's rule exactly:** renewal is a privilege of the operations that
  mirror the extension's `getPassphrase` (user-initiated wallet operations): a successful
  `unlock`, `unlock_with_biometric`, `enable_biometric_unlock`, `add_account`, `sign_hash` and
  `reveal_recovery_phrase`. Every read is passive, as `PassiveUnlockSession`: `accounts()`,
  `status()`, `security_status()`, `session_remaining_ms()`, balance polling and every `rpc_*`
  helper. There is no touch- or scroll-driven renewal, so browsing Home locks at 30 minutes just
  as the side panel does.
- Lock on background stays as today (iOS `scenePhase == .background`, Android `onStop`). The
  host also schedules a UI timer from `session_remaining_ms()` (a duration, since the core has no
  wall clock), so the unlock screen appears on time. The timer only affects the UI; the core check
  is what enforces the lock.

### 4.3 Biometric change → lock

The slot is invalidated **only on a real enrolment change or item loss**. An ordinary failure
never drops it, so nobody holding the phone can turn biometrics off by showing the wrong face.

- **iOS:** each time the scene becomes active, the host reads the domain state and passes a
  tri-state `BiometricDomain` to `reconcile_biometric_domain`:
  - `State { value }` only when `canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)`
    succeeds and `evaluatedPolicyDomainState` is non-nil. The core compares its SHA-256 with the
    slot's `domain`; a mismatch locks, drops the slot and returns `BiometricInvalidated`.
  - `NotEnrolled` when `canEvaluatePolicy` fails with `LAError.biometryNotEnrolled` (every face or
    finger removed): a real enrolment change, handled as a mismatch.
  - `Unavailable` for every other failure, including `LAError.biometryLockout` after repeated
    non-matches and a nil domain state: the slot is kept and the passphrase is offered.
  During a biometric unlock, `errSecItemNotFound` means the item is gone (enrolment changed under
  `.biometryCurrentSet`) and leads to `biometric_invalidated()`. `errSecAuthFailed` (face or finger
  did not match), `errSecUserCanceled` and `LAError.biometryLockout` fall back to the passphrase
  and **keep** the slot.
- **Android:** there is no domain-state API; the host passes `Unavailable`, and slots created on
  Android store an empty `domain`, so reconciling never drops them. Only
  `KeyPermanentlyInvalidatedException` from `cipher.init` (tried on every foreground and before
  every prompt) leads to `biometric_invalidated()`. `BiometricPrompt` errors (`ERROR_LOCKOUT`,
  `ERROR_CANCELED`, a non-match) fall back to the passphrase and keep the key.
- After a real invalidation the host deletes its Keychain item or Keystore alias and shows the
  passphrase field with **NEW** copy: "Face ID changed on this device. Enter your passphrase, then
  turn it on again in Security."

### 4.4 Clock (monotonic, boot-scoped; no wall clock)

The core never reads time itself (AGENTS.md: clocks live in boundary modules). The host injects
`HostClock` with two readings and **no wall-clock method**:

| Reading | iOS | Android |
| --- | --- | --- |
| `monotonic_ms()` — keeps counting while asleep, cannot be set by the user | `mach_continuous_time()` scaled by `mach_timebase_info` | `SystemClock.elapsedRealtime()` |
| `boot_id()` — changes on every boot | `sysctlbyname("kern.bootsessionuuid")` | `Settings.Global.BOOT_COUNT` |

A reading is only comparable with another from the same boot. Every comparison uses
`checked_sub`: a different boot id or a monotonic value below a stored stamp is treated as "time
unknown", which **restarts** a backoff delay and **ends** an idle session. Neither path can panic,
so no clock value can unwind across the FFI. Settings > Date & Time therefore has no effect on
either rule, and the only clock lever left, a reboot, costs the attacker the full delay again.
Durations handed to the host (`retry_after_ms`, `session_remaining_ms`) are relative, so the host
renders countdowns without the core ever learning the date.

## 5. User-visible behaviour, screen by screen

| Mobile screen | Extension counterpart | Behaviour |
| --- | --- | --- |
| Unlock (`UnlockView`) | `gate-views.ts locked()` | Unchanged copy: "Welcome back", "Unlock your wallet to continue.", field "Vault passphrase" / "Enter your passphrase", button "Unlock", toast "Vault unlocked". Wrong: "Incorrect passphrase" (shared string, replaces today's "Vault passphrase is incorrect"). Throttled: button disabled, status line counts down, **NEW** "Too many attempts. Try again in 1:59." With biometrics on: the prompt starts automatically once per appearance, and a secondary button **NEW** "Unlock with Face ID" / "Unlock with fingerprint" is shown. Cancelling returns to the passphrase field. |
| Header lock button | `#lock-button` "Lock wallet" | Unchanged; toast "Vault locked". |
| Settings hub | `settingsScreen` groups | The "Security" group gains a first row **NEW** "Unlock & auto-lock" (value "Face ID on" / "Passphrase only"), which opens the Security screen. "Lock wallet" and "Remove wallet from this device" stay. |
| Security screen (new) | `securityFlow` layout (flowHeader + eyebrow sections + `#display-result` status) | `FlowHeader` **NEW** "Unlock & auto-lock" / "How this device opens your wallet". Eyebrow "Biometric unlock": `SegmentedControl` Off/On (the ui-kit has no switch, so the extension's choice pattern is used, as Appearance does). Choosing On asks for the passphrase (`BrambleField`, secret) then the system prompt; status **NEW** "Face ID will unlock this wallet. Your passphrase still works and is still needed to reveal secrets." If unavailable, the control is disabled with **NEW** "Face ID is not set up on this device." Eyebrow "Auto-lock": `DetailRow` "After 30 minutes idle" and `DetailRow` "When Bramble leaves the screen" (read-only; see §9, D2). Android also shows `DetailRow` "Key storage: StrongBox" / "Secure hardware". |
| Reveal recovery secrets | `reveal-ui.ts` | The extension copy stays, and the passphrase is **always** required: biometrics never reveal. The extension's "Copy recovery phrase" button and its note are **left out on purpose**. Mask-until-tapped kept. Adds screenshot and recording protection (§5.3). |
| Create / backup phrase (`SavePhraseStep`) | onboarding "Show recovery phrase" | Same protections as reveal. No copy button (the extension has none here either). |
| Import (`RecoveryEntryGrid`) | `recoveryWordInputs` | Paste of a whole phrase into the first field is kept (extension parity). Afterwards the host clears the system clipboard with a write only, never a read, and shows toast **NEW** "Clipboard cleared". Masked while recording. |
| Remove wallet | (mobile only) | Passphrase re-check, now throttled. Also deletes `security.json`, the Keychain item and the Keystore alias. |

### 5.1 Keyboards and autofill

- iOS: app-wide block on third-party keyboards through a `UIApplicationDelegateAdaptor`
  (`application(_:shouldAllowExtensionPointIdentifier:)` returns `false` for `.keyboard`).
  Recovery-word fields: autocorrection off, capitalisation off, `.asciiCapable`, and
  `textContentType(nil)`. The vault passphrase: `SecureField` with `textContentType(nil)`, which
  removes today's `.password`. This departs from the extension, which allows password-manager
  autofill (`current-password`), because the brief asks for no autofill (§9, D3).
- Android (uncompiled): the single `SecretField` in `design/SecretField.kt` (from the
  android-parity port), an `AndroidView` `EditText` with `TYPE_CLASS_TEXT |
  TYPE_TEXT_VARIATION_PASSWORD | TYPE_TEXT_FLAG_NO_SUGGESTIONS`, `IME_FLAG_NO_PERSONALIZED_LEARNING
  | IME_FLAG_NO_EXTRACT_UI`, autofill excluded, no copy/cut/share, and no saved-instance state,
  because Compose 1.7's `KeyboardOptions` cannot set that IME flag. Phrase words use
  `VISIBLE_PASSWORD` with the same flags. See `docs/android-parity.md` T4 and T10.

### 5.2 App switcher

iOS: the existing `PrivacyCover` whenever `phase != .active` (kept). Android: the existing app-wide
`FLAG_SECURE`, plus `setRecentsScreenshotEnabled(false)` on API 33+.

### 5.3 Screenshots and recording

- Android: `FLAG_SECURE` already blocks both. Optionally add `registerScreenCaptureCallback`
  (API 34) to show the warning below.
- iOS has **no public API that blocks screenshots**. The design:
  1. Recording or mirroring: mask the words while `sceneCaptureState == .active` (moving from the
     deprecated `UIScreen.main.isCaptured`). This applies on reveal, backup **and import**.
  2. Screenshots: a `ScreenshotShield` view hosts the word grid inside the layer of a
     `UITextField` with `isSecureTextEntry = true`, which the system leaves out of screenshots and
     recordings. The trick is undocumented, so the shield **fails closed**: if the secure
     sublayer cannot be found at runtime, it shows the masked grid and "Tap to show" does nothing.
     This lives in one audited file (§9, D5).
  3. `userDidTakeScreenshotNotification` → toast **NEW** "Screenshot taken. If it shows your
     recovery phrase, delete it — other apps and your photo library can read screenshots." This
     is the warning SCOPE.md already claims, which does not exist yet.
- `.privacySensitive()` stays but is not counted as a protection (it only affects system
  redaction).

### 5.4 Clipboard

Secrets are never written to the clipboard. The only write stays the address copy (`localOnly`,
120 s expiry). Android gains the matching address copy and a 120 s clear (an address is not
secret, so `ClipDescription.EXTRA_IS_SENSITIVE` stays unset). Reading the clipboard only happens through the user's own paste
gesture into a field. After a multi-word paste the clipboard is cleared (`UIPasteboard.general.items
= []`; `ClipboardManager.clearPrimaryClip()`).

## 6. Threat model

| # | Threat | Mitigation | Residual |
| --- | --- | --- | --- |
| T1 | Stolen, locked phone | Vault under complete file protection; W behind Secure Enclave-enforced biometry / Keystore auth; passphrase guesses throttled | Nation-state SEP/TEE compromise |
| T2 | Offline attack on a copied `vault.json` | PBKDF2 600k on the passphrase slot; the biometric slot is useless without W | Weak passphrases (setup meter and acknowledgement already implemented) |
| T3 | Guessing through the UI, including killing the app mid-attempt | Core-enforced backoff, counted before the KDF, persisted | An attacker with filesystem write can reset the counter, but can already do T2 |
| T4 | Changing the clock, or rebooting, to skip backoff | The delay counts down only on the host's monotonic clock (keeps counting in sleep, cannot be set); wall-clock changes have no effect; a new boot id or a monotonic value below the stamp restarts the full delay | An attacker with filesystem write can edit the stamp, but can already do T2 |
| T5 | Someone adds a face or finger | `.biometryCurrentSet` / `setInvalidatedByBiometricEnrollment` + domain-state check → lock, drop slot | — |
| T6 | Device passcode known to the attacker | No passcode fallback on the biometric key; reveal always needs the vault passphrase | Passcode lets an attacker enrol a new face, which triggers T5 |
| T7 | Walk-away while unlocked | 30 min idle lock in the core; lock on background; polling never renews | Within the 30 min |
| T8 | Screenshot, recording, app switcher, shoulder-surfing | §5.2–5.3; mask until tapped | iOS screenshot shield relies on undocumented behaviour (fails closed) |
| T9 | Keyboard logging or learning; autofill sync | Third-party keyboards blocked on iOS; no-learn flags; no content types | System keyboard trusted |
| T10 | Clipboard exfiltration or Universal Clipboard sync | No secret copy; clear after paste | A clipboard manager may already have captured the paste |
| T11 | Memory scraping on a jailbroken or rooted device | DEK, KEK and phrase in zeroizing Rust types; W wiped in host buffers | Host `String` passphrases, UniFFI buffers (SCOPE.md known limits) |
| T12 | Tampered vault container (slot swap, downgrade to v1) | AAD binds scope, lineage and slot id; strict shape; a v1 file only opens with the passphrase, and migrating it runs the same checks | A deleted slot means biometrics off (denial of service only) |
| T13 | Stale Keychain item after reinstall | Deleted on `NoWallet`; the slot id must match | — |
| T14 | Unlock racing lock or auto-lock | One session mutex; expiry is checked under the lock; `lock()` bumps a lock epoch that an in-flight unlock re-checks before installing its session, so lock always wins | — |
| T15 | Concurrent passphrase guesses (lock screen + reveal/delete sheet, repeated taps) | One attempt mutex held for the whole attempt; the counter is read, checked, incremented and persisted under it before the KDF | — |
| T16 | Wrong face or finger, or biometric lockout, used to disable biometrics | Only enrolment change or item loss drops the slot (§4.3) | — |

## 7. UniFFI surface (Rust signatures)

```rust
// lib.rs — CoreError gains three variants (UniFFI enums are append-only in intent):
Throttled { retry_after_ms: u64 },
BiometricUnavailable,          // no slot, or the slot was dropped
BiometricInvalidated,          // enrolment changed or the slot failed authentication; slot now removed

/// Host clock, injected so the pure core never reads time. Monotonic and boot-scoped: the core
/// has no wall clock at all.
#[uniffi::export(with_foreign)]
pub trait HostClock: Send + Sync {
    /// Milliseconds on a clock that keeps counting while the device sleeps and that the user
    /// cannot set (iOS `mach_continuous_time`; Android `SystemClock.elapsedRealtime()`).
    fn monotonic_ms(&self) -> u64;
    /// Changes on every boot (iOS `kern.bootsessionuuid`; Android `Settings.Global.BOOT_COUNT`).
    fn boot_id(&self) -> String;
}

/// What the host could learn about biometric enrolment right now.
#[derive(uniffi::Enum)]
pub enum BiometricDomain {
    Unavailable,                  // lockout, temporarily unavailable, or no domain-state API
    NotEnrolled,                  // every face or finger removed: a real enrolment change
    State { value: Vec<u8> },     // canEvaluatePolicy succeeded; the current domain state
}

#[derive(uniffi::Record)]
pub struct SecurityStatus {
    pub biometric_enabled: bool,
    pub retry_after_ms: u64,        // 0 when a passphrase attempt is allowed now
    pub failed_attempts: u32,
    pub idle_lock_ms: u64,          // the generated constant, for display
    pub session_remaining_ms: Option<u64>,
}

// wallet.rs
#[uniffi::constructor]
pub fn new(data_dir: String, clock: Arc<dyn HostClock>) -> Result<Arc<Self>, CoreError>;
pub fn security_status(&self) -> SecurityStatus;          // passive: never renews
pub fn session_remaining_ms(&self) -> Option<u64>;        // passive: never renews

/// Re-checks the passphrase (throttled), then wraps the DEK under `wrap_secret` (exactly 32 bytes,
/// host-generated, host-wiped) and stores the slot. Never returns key material.
pub fn enable_biometric_unlock(&self, password: String, wrap_secret: Vec<u8>,
                               domain_state: Option<Vec<u8>>) -> Result<(), CoreError>;
/// Removes the biometric slot. Needs no key, so it works while locked.
pub fn disable_biometric_unlock(&self) -> Result<(), CoreError>;
/// Unwraps the DEK with `wrap_secret` and opens the session. On GCM failure it drops the slot.
pub fn unlock_with_biometric(&self, wrap_secret: Vec<u8>) -> Result<(), CoreError>;
/// Compares the host's biometric domain with the slot. `State` mismatch or `NotEnrolled` locks and
/// drops the slot (`BiometricInvalidated`); `Unavailable` keeps it.
pub fn reconcile_biometric_domain(&self, domain: BiometricDomain) -> Result<(), CoreError>;
/// Android path: the Keystore reported invalidation. Locks and drops the slot.
pub fn biometric_invalidated(&self);
```

Unchanged signatures, new behaviour: `unlock`, `reveal_recovery_phrase` and `delete_wallet` are
throttled and counted under the attempt mutex; a successful passphrase open migrates v1 → v2;
every session method checks idle expiry;
`status()` checks idle expiry. `password: String` and `wrap_secret: Vec<u8>` move into
`Zeroizing` on entry (this also closes the SCOPE.md gap for today's `password` arguments).

**Never crosses:** DEK, KEK, the payload, the salt or IV of any slot, the counter file contents
beyond `SecurityStatus`, W in the core → host direction, and any byte of `vault.json`. No new method
returns `Vec<u8>` or `String` derived from a secret. A Rust test enumerates the exported
methods (from the UniFFI metadata) and fails when a new one returns bytes (§8.1).

## 8. Test plan

Moved to [vault-security-tests.md](vault-security-tests.md) (Rust, Swift unit, XCUITest,
Android and parity fixtures).

## 9. Decisions for the user, and what depends on krusty-kms

- **D1** iOS Keychain + biometry ACL (chosen, testable on the Simulator) vs Secure Enclave ECIES
  around W (device-only). Both can be added later without a core change.
- **D2** An idle-timeout **picker** has no extension source. The design ships the extension's fixed
  30 min. A picker should first be added to the extension (`UnlockSessionOptions.ttlMs` +
  Appearance-style screen), and mobile would then generate its options.
- **D3** Passphrase autofill: the brief says off, the extension allows `current-password`. The
  design turns it off on mobile.
- **D4** Wipe-after-N-failures: rejected by default (it destroys funds when there is no backup).
  It could only be offered later as an opt-in setting.
- **D5** Using the undocumented iOS secure-layer screenshot shield (fail closed) vs relying on
  recording masking + screenshot warning only.
- **D6** The extension's "Copy recovery phrase": mobile drops it on purpose. Should the extension
  follow?
- SCOPE.md updates needed: the new W crossing, the "screenshot warning" claim (implemented by this
  work), and removing the invalid `INFOPLIST_KEY_NSFileProtectionComplete` claim. The Data
  Protection entitlement (`com.apple.developer.default-data-protection = NSFileProtectionComplete`,
  `ios/Bramble/Bramble.entitlements`, generated by XcodeGen from `project.yml`) replaces it, and
  the app re-asserts `.complete` on the `vault` directory every launch so the core's new files
  (`security.json`, `vault.json.tmp`) inherit it.

**krusty-kms 0.11.0:** it has no PBKDF2 or AES-GCM, no key wrapping, no AAD on
`encrypt_with_key`, no attempt counter, clock or biometric hooks. **Nothing here is blocked on it**:
vault encryption, key wrapping, backoff and auto-lock are Bramble storage policy, built in Rust
from the RustCrypto crates the core already pins, exactly as the extension builds its envelope
on WebCrypto rather than krusty. None of it is signing, key derivation or mnemonic validation,
so it is not fallback wallet crypto. krusty's XChaCha AEAD is deliberately **not** used for the
DEK, to avoid a second cipher in the vault. An optional upstream hardening (AAD on
`encrypt_with_key`, and `Zeroizing` returns from `decrypt_*`, `generate_mnemonic` and
`mnemonic_to_seed`) is worth proposing to krusty but is not required here.
