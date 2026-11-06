# Bramble Mobile

iOS (SwiftUI) and Android (Jetpack Compose) wallets over one Rust core, `bramble-core`, built on
Krusty KMS. Read [SCOPE.md](SCOPE.md) for the architecture, security posture, and roadmap.

```
mobile/
  core/        Rust core (UniFFI). Tests: cargo test --locked
  ios/         SwiftUI app (XcodeGen spec; the .xcodeproj is generated)
  android/     Compose app (Gradle Kotlin DSL)
  scripts/     build-core-ios.sh, build-core-android.sh, lint.sh, lint-tools.sh
```

Generated files (`*.generated.swift|kt`, `core/generated/networks.json`, the brand-mark assets,
and `core/tests/fixtures/extension-parity.json`) come from the extension's TypeScript packages.
Never edit them by hand: run `bun run mobile:assets` or `bun run mobile:parity` from the repo
root. `bun run check` fails when they drift.

## Linting

Swift and Kotlin are linted strictly by pinned tools: SwiftLint 0.65.1, ktlint 1.8.0 (official
style) and detekt 1.23.8 (every rule on). `mobile/scripts/lint-tools.sh` downloads each release
once into the git-ignored `mobile/.tools/` and checks it against a SHA-256 recorded in the script;
a mismatch deletes the download and fails. Nothing is installed system-wide.

```bash
bun run mobile:lint                  # both platforms; exits non-zero on any finding
bash mobile/scripts/lint.sh swift    # SwiftLint over mobile/ios (macOS only)
bash mobile/scripts/lint.sh kotlin   # ktlint + detekt over mobile/android
```

ktlint and detekt run on `$JAVA_HOME`, or on Homebrew's keg-only `/opt/homebrew/opt/openjdk` when
it is unset (JDK 17+; detekt 1.23.8 is verified on JDK 26). SwiftLint's analyzer rules
(`unused_import`, `unused_declaration`, `capture_variable`, `typesafe_array_init`) need the log of
a clean build:

```bash
cd mobile/ios && mkdir -p build && xcodebuild -project Bramble.xcodeproj -scheme Bramble \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' clean build-for-testing | tee build/xcodebuild.log
cd ../.. && bash mobile/scripts/lint.sh swift-analyze mobile/ios/build/xcodebuild.log
```

Configs: `ios/.swiftlint.yml`, `android/.editorconfig` (ktlint) and `android/config/detekt.yml`.
Generated sources are excluded. Never suppress a finding in source (`swiftlint:disable`,
`@Suppress`, `ktlint-disable`): `lint.sh` reports those markers as findings too. Fix the code, or
change the config in review. `mobile:lint` is not part of `bun run check`, which must pass on
Linux and on machines without a JDK; it runs in `.github/workflows/mobile.yml`.

## CI

`.github/workflows/mobile.yml` runs on PRs touching `mobile/**`: `cargo fmt --check`, clippy
(`-D warnings`) and `cargo test --locked` on Linux; `bun run mobile:lint` on macOS; the iOS core
build, XcodeGen, `BrambleTests` on a simulator and SwiftLint's analyzer rules on macOS; and the
Android core build plus `./gradlew :app:testDebugUnitTest`. The UI tests (`BrambleUITests`) and the
Android instrumented suite stay local. The Android job has not run on GitHub yet; its steps pass
locally (see Android below).

## Rust core

```bash
cd mobile/core
cargo test --locked                  # unit, lifecycle, and extension-parity tests
cargo clippy --all-targets --locked
```

Opt-in check against a real mainnet wallet (never in CI; never commit the phrase):

```bash
BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" BRAMBLE_MOBILE_MAINNET_ADDRESS=0x… \
  cargo test --locked --test mainnet -- --ignored
```

## iOS

Needs Xcode 16+, XcodeGen, and the `aarch64-apple-ios` / `aarch64-apple-ios-sim` Rust targets.

```bash
mobile/scripts/build-core-ios.sh debug     # XCFramework + Swift bindings into ios/Generated
cd mobile/ios && xcodegen generate && open Bramble.xcodeproj
```

Tests (unit + mainnet UI flow) on a simulator:

```bash
xcrun simctl uninstall "iPhone 16" org.bramble.wallet   # the UI suite starts from a fresh install
xcodebuild -project Bramble.xcodeproj -scheme Bramble \
  -destination 'platform=iOS Simulator,name=iPhone 16' test
```

Simulator builds are signed ad hoc by `project.yml` (`CODE_SIGN_IDENTITY[sdk=iphonesimulator*]`);
don't pass `CODE_SIGNING_ALLOWED=NO`: an unsigned app cannot use the data-protection Keychain, so
biometric unlock and `SecurityTests` would fail. `SecurityFlowTests` drives the simulator's Face ID
(enrol, match, non-match) itself. Every UI test removes its wallet when it finishes, and
`SecurityFlowTests` also removes one left behind by an earlier run, so the whole scheme runs in one
go after a single uninstall. Vault security is specified in
[docs/vault-security.md](docs/vault-security.md).

The UI suite imports the published E2E phrase on mainnet by default. To run it against a funded
wallet, prefix the command with `TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_MNEMONIC="…"` and
`TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_ADDRESS=0x…`. XCUITest records typed text in the `.xcresult`
activity log, so delete the result bundle after a run with a real phrase.

## Android

Needs JDK 17, Android SDK platform 35 with an API 35 emulator image, NDK r27+, the
`aarch64-linux-android` / `x86_64-linux-android` Rust targets, and
`cargo install cargo-ndk --version 4.1.2 --locked`. The Gradle wrapper is committed and pinned
(Gradle 8.11.1, distribution SHA-256 checked); do not regenerate it.

```bash
ANDROID_NDK_HOME=… mobile/scripts/build-core-android.sh debug
cd mobile/android && ./gradlew installDebug
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest                # JVM: QR parity, input rules, source hygiene
./gradlew :app:connectedDebugAndroidTest        # emulator only: flows, security, core bridge
```

Headless emulator for the instrumented suite (an API 35 AVD, here `Bramble_API35`):

```bash
emulator -avd Bramble_API35 -no-window -no-audio -no-snapshot &
adb wait-for-device && until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
cd mobile/android && ./gradlew :app:connectedDebugAndroidTest
adb emu kill
```

The build copies the extension's onboarding landscape and the core's parity fixture into
`app/build/generated` (never committed). Instrumented tests run under Android Test Orchestrator
with `clearPackageData=true`, so each starts from a fresh install state. The opt-in
`LiveMainnetWalletTest` takes `BRAMBLE_MOBILE_MAINNET_MNEMONIC` / `_ADDRESS` as instrumentation
arguments and is refused with `ci=true`, which the build sets whenever the host's `CI` is set.
`bun mobile/android/scripts/qr-fixture.ts` regenerates the QR parity fixture. Design and threat model: [docs/android-parity.md](docs/android-parity.md).

Status (2026-09-25, JDK 17, SDK 35, NDK 27.2, API 35 emulator): `:app:assembleDebug` builds;
`:app:testDebugUnitTest` passes 38 JVM tests; `:app:connectedDebugAndroidTest` passes 36
instrumented tests, with the opt-in `LiveMainnetWalletTest` skipped. Several instrumented tests
(onboarding, Home, Activity) read public mainnet data, as the iOS UI suite does; the deploy, token
detail and Settings deploy-row tests route the store's chain reads through an offline fixture node
(`androidTest/.../FixtureNode.kt`) that refuses every write. `bun run mobile:lint` is clean. The
Android job has not run in CI yet (SCOPE.md, Phase 1.1).

## Sending

Design and review resolutions: [docs/transactions.md](docs/transactions.md). A transfer plan is
bound to the vault session generation (`lock_epoch`), so any lock, idle lock or new unlock voids a
reviewed plan. The send UI test (`BrambleUITests/SendFlowTests`) runs on the offline fixture
transport (`-uiTestOfflineFixtures ready|undeployed|unfunded|feeFailure`, DEBUG only), whose
nonce, estimate and class-hash replies are generated from the extension's recorded send path; it
never taps "Confirm and send". A real mainnet send is opt-in and never run in CI:

```bash
TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_SEND_ACK="I understand this broadcasts a real mainnet transaction" \
TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" \
  xcodebuild … -only-testing:BrambleTests/MainnetSendTests test
```

## Private balances

Read-only STRK20 privacy (viewing key derived in the core, discovery through the privacy service,
the extension's gates and copy); nothing is submitted yet. Design, deviations and the pending
SCOPE.md decision: [docs/privacy.md](docs/privacy.md). UI tests use `-BramblePrivacyFixture`.

The live, read-only reads send the wallet's scoped viewing key to the discovery service, as the
extension does. Both are opt-in, skipped by default, and refused when `CI`, `GITHUB_ACTIONS` or
their `TEST_RUNNER_` forms are set:

```bash
# Rust (the test moves the bytes with the system curl; the core stays sans-IO)
BRAMBLE_MOBILE_PRIVACY_LIVE_ACK="I understand this sends my viewing key to the privacy service" \
BRAMBLE_MOBILE_MAINNET_MNEMONIC="…" BRAMBLE_MOBILE_MAINNET_ADDRESS=0x… \
  cargo test --locked --test privacy_mainnet -- --ignored --nocapture

# iOS: the same variables with the TEST_RUNNER_ prefix, then
xcodebuild … -only-testing:BrambleTests/MainnetPrivacyTests test
```

They print public results only: deployment, registration, per-token private totals, the pool
fee, each discovery page's `block_ref`, and latencies. Delete the `.xcresult` afterwards.

### Pointing at your own privacy service

The discovery URL defaults to the extension's generated routing (`core/generated/privacy.json`).
To use another service, without code changes:

| Where | Setting |
| --- | --- |
| Rust tests | `BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL=https://…` |
| iOS app (DEBUG build) | launch argument `-BramblePrivacyDiscoveryURL https://…`, or the environment variable `BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL` |
| iOS unit tests | `TEST_RUNNER_BRAMBLE_MOBILE_PRIVACY_DISCOVERY_URL=https://…` |
| XCUITests | add `-BramblePrivacyDiscoveryURL`, `https://…` to `app.launchArguments` |

The core (`set_privacy_discovery_override`) judges the URL with the rules it applies to the
generated routing: `https` only, at most 2048 bytes, no credentials, query, fragment, whitespace
or trailing slash. It applies only to a network that is already routed, so it never enables
Sepolia or a network whose routing turns OHTTP on. A release build of the core refuses every
override. A refused override stops the app's launch (and fails the tests) instead of falling back
to the default service. The URL is the service base; the core appends `/v1/sync/…`. Mobile has no
prover client yet, so there is no prover URL to override.
