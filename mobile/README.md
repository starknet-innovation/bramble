# Bramble Mobile

iOS (SwiftUI) and Android (Jetpack Compose) wallets over one Rust core, `bramble-core`, built on
Krusty KMS. Read [SCOPE.md](SCOPE.md) for the architecture, security posture, and roadmap.

```
mobile/
  core/        Rust core (UniFFI). Tests: cargo test --locked
  ios/         SwiftUI app (XcodeGen spec; the .xcodeproj is generated)
  android/     Compose app (Gradle Kotlin DSL)
  scripts/     build-core-ios.sh, build-core-android.sh
```

Generated files (`*.generated.swift|kt`, `core/generated/networks.json`, the brand-mark assets,
and `core/tests/fixtures/extension-parity.json`) come from the extension's TypeScript packages.
Never edit them by hand: run `bun run mobile:assets` or `bun run mobile:parity` from the repo
root. `bun run check` fails when they drift.

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
./gradlew :app:testDebugUnitTest                # JVM: QR parity, input rules, source hygiene
./gradlew :app:connectedDebugAndroidTest        # emulator only: flows, security, core bridge
```

The build copies the extension's onboarding landscape and the core's parity fixture into
`app/build/generated` (never committed). Instrumented tests run under Android Test Orchestrator
with `clearPackageData=true`, so each starts from a fresh install state. The opt-in
`LiveMainnetWalletTest` takes `BRAMBLE_MOBILE_MAINNET_MNEMONIC` / `_ADDRESS` as instrumentation
arguments and is refused with `ci=true`, which the build sets whenever the host's `CI` is set.
`bun mobile/android/scripts/qr-fixture.ts` regenerates the QR parity fixture. Design and threat model: [docs/android-parity.md](docs/android-parity.md).

The Android app has not yet been compiled (no Android toolchain where it was written) or built in
CI (SCOPE.md, Phase 1.1).
