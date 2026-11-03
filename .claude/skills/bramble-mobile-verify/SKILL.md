---
name: bramble-mobile-verify
description: Build, launch and drive the Bramble iOS or Android app on a simulator or emulator to see a change working — screenshot a screen, click through a flow, or run the UI/instrumented suites. Use when asked to run, demo, screenshot or verify the mobile wallet, or to check a mobile change on a real device image.
---

# Verifying Bramble mobile on a simulator or emulator

Commands run from the repository root unless a `cd` says otherwise. `mobile/README.md` is the
reference for the suites; this is the loop for seeing the app.

## Preflight

```bash
xcodebuild -version && xcrun simctl list devices available | grep -m1 iPhone   # iOS
java -version && adb version && emulator -list-avds                            # Android
```

If one fails, stop and say which tool is missing. Android needs `~/.zprofile`'s `JAVA_HOME`,
`ANDROID_HOME` and `ANDROID_NDK_HOME`. A non-login shell may not have them, so `source` it first.

## Pick the loop

| Goal | Command |
| --- | --- |
| Core logic | `cd mobile/core && cargo test --locked` |
| iOS logic | `xcodebuild … -only-testing:BrambleTests test` |
| Android logic | `cd mobile/android && ./gradlew :app:testDebugUnitTest` |
| A flow, repeatably | `-only-testing:BrambleUITests/<Class>` · `connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=<fqcn>` |
| See a screen | build, install, launch, screenshot (below) |

**The full iOS UI suite takes about 36 minutes on one simulator.** While iterating, run only the
classes your change touches with `-only-testing:BrambleUITests/<Class>`. Each takes 1 to 8
minutes; add `test-without-building` when only the run needs repeating. Run the whole scheme once,
before pushing:

- **One simulator, about 36 minutes.** Reliable. Use it when the result has to be trusted.
- **Four parallel clones, about 23 minutes.** Add `-parallel-testing-enabled YES
  -parallel-testing-worker-count 4`. In both clone runs measured here, one clone could not
  launch the runner ("Busy", "Application failed preflight checks"). Its tests then move to the
  other clones, but
  `xcodebuild` still prints `** TEST FAILED **` and exits 65. Judge the run by its
  `Test case '…' passed|failed` lines, not by the exit code. Under that load, timing-sensitive
  tests (Face ID enrolment, app launch) fail more often. Rerun a failed class alone before
  blaming the change.

More simulators do not help on one Mac: CPU is the limit, and every class slowed by 20–75%
(most by 35–50%).

## iOS

```bash
mobile/scripts/build-core-ios.sh debug                       # after any core change
bash mobile/scripts/lint-tools.sh xcodegen                   # once: pinned XcodeGen
cd mobile/ios && ../.tools/xcodegen-2.44.1/xcodegen/bin/xcodegen generate -q
D=$(xcrun simctl list devices available | grep -m1 -E '^\s+iPhone' | grep -oE '[0-9A-F-]{36}')
xcodebuild -project Bramble.xcodeproj -scheme Bramble -destination "id=$D" \
  -derivedDataPath build/DerivedData build
xcrun simctl boot "$D"
xcrun simctl install "$D" build/DerivedData/Build/Products/Debug-iphonesimulator/Bramble.app
xcrun simctl launch "$D" org.bramble.wallet -network sepolia -uiTestOfflineFixtures ready
xcrun simctl io "$D" screenshot --mask=alpha <scratchpad>/shot.png
```

- Pick the device by what `simctl` lists. The README's "iPhone 16" is not on a current Xcode.
- `-uiTestOfflineFixtures ready|empty|balanceError|undeployed|unfunded|feeFailure` (DEBUG only)
  answers every chain read from the recorded fixture node and refuses every write.
  `-BramblePrivacyFixture offline|registered|service-failed` does the same for private balances.
  Both take a value, and an unknown value is ignored silently. Without them the app reads live
  public data. `-network sepolia|mainnet` picks the network.
- A device with more than one screen (iPhone Duo) needs `--display=1` on `screenshot`.
- To see the device outline, run `swift .claude/skills/bramble-mobile-verify/frame.swift "<device
  type>" shot.png framed.png`, with the device type `simctl` lists, such as "iPhone 18 Pro". This
  needs a `--mask=alpha` shot. Without one, the screen keeps square corners.
- Some Xcode installs have no Simulator.app (27.2 here did not). Then a screenshot is the only
  view, so don't promise the user a window.

**Driving it.** `simctl` cannot tap. Drive with a throwaway UI test that reuses
`BrambleUITests/UITestSupport.swift`. `UITest.launch()` starts offline on Sepolia.
`UITest.openWallet` unlocks the wallet an earlier test left, or imports the published phrase on a
fresh install. Then dump what is on screen:

```swift
// mobile/ios/BrambleUITests/ZZProbeTests.swift — delete after use
import XCTest

final class ZZProbeTests: XCTestCase {
    func testProbe() throws {
        try UITest.refuseRealPhrase()
        let out = ProcessInfo.processInfo.environment["PROBE_OUT"] ?? NSTemporaryDirectory()
        let app = UITest.launch()
        UITest.openWallet(app)
        // …drive further…
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "\(out)/probe.png"))
        try app.debugDescription.write(toFile: "\(out)/probe-tree.txt", atomically: true, encoding: .utf8)
    }
}
```

Run `xcodegen generate` (it picks up new files), then
`TEST_RUNNER_PROBE_OUT=<scratchpad> xcodebuild … -resultBundlePath <scratchpad>/probe.xcresult
-only-testing:BrambleUITests/ZZProbeTests test`. On a fresh install `openWallet` types the
published phrase, so delete `probe.xcresult` afterwards.
Read the PNG and the tree, then delete the probe and regenerate. For a fresh-install start, run
`xcrun simctl uninstall "$D" org.bramble.wallet` first. Imports and test assertions can fail under
a newer Xcode than CI's while the app still works: read `probe.png` before blaming the app.

## Android

```bash
source ~/.zprofile
mobile/scripts/build-core-android.sh debug                    # after any core change
emulator -avd Bramble_API35 -no-window -no-audio -no-snapshot &
adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
cd mobile/android && ./gradlew -q :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n org.bramble.wallet/.MainActivity
adb exec-out screencap -p > <scratchpad>/shot.png
adb emu kill                                                  # when done
```

**Driving it.** `adb shell uiautomator dump /sdcard/ui.xml && adb exec-out cat /sdcard/ui.xml`
gives every node's `text`, `content-desc` and `bounds`. Tap the centre of a node's bounds with
`adb shell input tap X Y`, and type with `adb shell input text` (write each space as `%s`). Dump
before every tap: never reuse coordinates from another screen or another AVD.
- A headless cold boot can leave "System UI isn't responding" holding focus even after
  `boot_completed`. Instrumented tests then fail with `RootViewWithoutFocusException` or an empty
  clipboard, which looks like an app bug. After boot, run
  `adb shell settings put global hide_error_dialogs 1` and `adb shell input keyevent KEYCODE_ENTER`.
  Then check that `adb shell dumpsys window | grep mCurrentFocus` names no "Not Responding" window.
- `monkey` does not launch this app; use `am start`.
- The app has no launch-time fixtures, so driving it by hand reads live public data.

**Driving it offline.** The fixture node lives only in the instrumented tests. Use a throwaway
test on the same helpers (`Robot.kt`, `FixtureNode.kt`):

```kotlin
// mobile/android/app/src/androidTest/java/org/bramble/wallet/ZZProbeTest.kt — delete after use
package org.bramble.wallet

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToLog
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestName
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ZZProbeTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @get:Rule val name = TestName()

    @Test
    fun probe() {
        val r = Robot(rule, name.methodName)
        r.waitForButton("Create a new wallet")
        openPublicWalletOn(FixtureNode(deployed = true))
        r.waitForHome()
        // …drive further with r.tap / r.tapDescribed / r.waitForText…
        r.snapshot("probe")
        rule.onRoot(useUnmergedTree = true).printToLog("PROBE")
    }
}
```

```bash
adb logcat -c
./gradlew -q :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=org.bramble.wallet.ZZProbeTest
find app/build/outputs/connected_android_test_additional_output -name '*probe*.png'
adb logcat -d -s 'PROBE:*'          # the Compose semantics tree: text, descriptions, bounds
```

- `openPublicWalletOn` imports the published phrase straight into the store, without the UI.
- `FixtureNode` answers chain RPC only, and refuses writes (`node.writes`). Prices and other
  portfolio data still go live through `portfolio/BoundedHttp.kt`.
- The orchestrator clears app data after each test, so the probe's screen is gone once the test
  ends. Capture everything inside it.
- Run `build-core-android.sh` after every pull or rebase. Stale bindings fail in `main`
  sources, such as "Argument type mismatch", not in your probe.

## Rules

- Import only the published E2E phrase (`UITest.publicPhrase`). Never type a real phrase into a
  simulator.
- Never set the `*_ACK` variables or `*_MAINNET_MNEMONIC`, and never tap "Confirm and send" outside
  the offline fixtures.
- Delete every `.xcresult` from a run that typed a phrase. XCUITest records typed text in it.
- Screenshots and result bundles go in the scratchpad. Probe sources must sit in the test
  targets, so `mobile/.gitignore` ignores `ZZProbe*`. Delete them after use anyway.

## Before calling it done

`bun run mobile:lint`, plus the platform's unit tests for whatever changed. Delete the probe and
shut down with `xcrun simctl shutdown all` and `adb emu kill`. CI builds with Xcode 16.4. A
newer local Xcode can pass or fail where CI does not, so say which one you used.
