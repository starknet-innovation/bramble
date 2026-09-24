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
  -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO test
```

The UI suite imports the published E2E phrase on mainnet by default. To run it against a funded
wallet, prefix the command with `TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_MNEMONIC="…"` and
`TEST_RUNNER_BRAMBLE_MOBILE_MAINNET_ADDRESS=0x…`. XCUITest records typed text in the `.xcresult`
activity log, so delete the result bundle after a run with a real phrase.

## Android

Needs Android Studio / SDK 35, NDK r27+, and `cargo install cargo-ndk --version 4.1.2 --locked`.

```bash
ANDROID_NDK_HOME=… mobile/scripts/build-core-android.sh debug
cd mobile/android && gradle wrapper --gradle-version 8.11.1 && ./gradlew installDebug
```

The Android app has not yet been compiled in CI (SCOPE.md, Phase 1.1).

## Sending

Design and review resolutions: [docs/transactions.md](docs/transactions.md). The send UI test
(`BrambleUITests/SendFlowTests`) runs against a canned node (`-BrambleRpcFixture`, DEBUG only)
and never taps "Confirm and send". A real mainnet send is opt-in and never run in CI:

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
