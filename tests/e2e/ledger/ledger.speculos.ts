/**
 * Ledger import and blind-sign paths (TA-32…TA-38 shapes) against the Speculos
 * emulator, through the Playwright-only HID bridge. Offline suite: the device
 * is seeded with the repository's PUBLIC test phrase; S-LDG never appears here.
 *
 * Runs only under `playwright.ledger.config.ts`, started by
 * `bun run test:e2e:ledger` with a pinned Speculos for one model. The default
 * E2E suite does not match this file. If the emulator is unreachable, every
 * test fails in `beforeAll`: never skipped, never a vacuous pass.
 *
 * Order matters: the app's Blind signing setting lives in the emulator for
 * the whole run, so the "setting off" refusal runs before it is turned on.
 * Not exercised: Chrome's real device chooser (the fake grants at once), and
 * the dashboard itself (canned replies, pinned in `dashboard.test.ts`).
 */
import { ledgerMessage } from "@bramble/ledger-protocol/errors";
import { expect, test } from "@playwright/test";
import { type LoadedExtension, launchExtension } from "../extension-fixture";
import {
  approveHashReview,
  enableBlindSigning,
  rejectBlindSigningPrompt,
  rejectHashReview,
} from "./device-actions";
import { EXPECTED_LEDGER_ACCOUNTS } from "./expected-accounts";
import { LedgerHidBridge } from "./hid-bridge";
import {
  addLedgerAccount,
  comparableHash,
  comparableScreen,
  onboardToLedgerPicker,
  openUnlockedPanel,
  type PendingLedgerSign,
  requestLedgerSignature,
} from "./ledger-flows";
import {
  probeSpeculos,
  SpeculosApdu,
  type SpeculosEndpoints,
  SpeculosScreen,
  speculosEndpointsFromEnv,
} from "./speculos";

const STARKNET_CLA = 0x5a;
const SIGN_HASH_INS = 0x02;
// `UserCancelled` in the app's Ledger Rust SDK io (legacy), the app's own
// SW_DENY. App 2.4.x sends it for a reject and for Blind signing off alike.
const USER_CANCELLED = 0x6985;

const endpoints = speculosEndpointsFromEnv();

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(async () => {
  const reason = endpoints
    ? await probeSpeculos(endpoints)
    : "BRAMBLE_SPECULOS_MODEL is not set; run `bun run test:e2e:ledger`";
  if (reason !== null) {
    throw new Error(`Speculos is unavailable: ${reason}`);
  }
});

type Rig = {
  readonly apdu: SpeculosApdu;
  readonly bridge: LedgerHidBridge;
  readonly extension: LoadedExtension;
  readonly screen: SpeculosScreen;
  readonly speculos: SpeculosEndpoints;
};

const withRig = async (run: (rig: Rig) => Promise<void>): Promise<void> => {
  if (!endpoints) {
    throw new Error("BRAMBLE_SPECULOS_MODEL is not set");
  }
  const speculos: SpeculosEndpoints = endpoints;
  const apdu = new SpeculosApdu(speculos);
  const bridge = new LedgerHidBridge({ backend: apdu, model: speculos.model });
  const extension = await launchExtension();
  try {
    // Before any wallet page opens, so every page (grant tab included) gets it.
    await bridge.install(extension.context);
    await run({ apdu, bridge, extension, screen: new SpeculosScreen(speculos), speculos });
  } finally {
    await extension.close();
    apdu.close();
  }
};

/** Onboards the LedgerW OZ account 0 and returns a pending dapp signature. */
const importAndRequestSign = async (rig: Rig): Promise<PendingLedgerSign> => {
  const expected = EXPECTED_LEDGER_ACCOUNTS;
  const onboarding = await onboardToLedgerPicker(rig.extension);
  await addLedgerAccount(onboarding, expected.ledgerW);
  const sidepanel = await openUnlockedPanel(rig.extension);
  return requestLedgerSignature(rig.extension, sidepanel);
};

// Statuses of every sign-hash APDU the device answered, in order. One attempt
// is the path APDU (P1 = 0, 0x9000) then the hash APDU (P1 = 1).
const signHashStatuses = (bridge: LedgerHidBridge): readonly number[] =>
  bridge.log
    .filter((entry) => entry.cla === STARKNET_CLA && entry.ins === SIGN_HASH_INS)
    .map((entry) => entry.status);

// Status of the hash APDU (P1 = 1), the one the user answers on the device;
// the preceding path APDU (P1 = 0) always succeeds and is not the outcome.
const lastSignHashStatus = (bridge: LedgerHidBridge): number | undefined =>
  bridge.log.filter((entry) => entry.cla === STARKNET_CLA && entry.ins === SIGN_HASH_INS).at(-1)
    ?.status;

test("imports LedgerW and finds the argentx (Ready) account from the device", async () => {
  await withRig(async ({ bridge, extension }) => {
    const expected = EXPECTED_LEDGER_ACCOUNTS;
    const onboarding = await onboardToLedgerPicker(extension);
    // The grant tab opened the device; nothing was pre-granted.
    expect(bridge.isGranted).toBe(true);
    // Both derivations reached the device: TA-32 shape (LedgerW, OZ) and the
    // TA-33 shape (argentx, Argent 0.4.0). Offline, a Ready row cannot be
    // imported (no activity to find), so it is asserted as derived only.
    await expect(
      onboarding.locator(`input[data-ledger-toggle="SN_MAIN:${expected.argentx}"]`),
    ).toBeAttached();
    await addLedgerAccount(onboarding, expected.ledgerW);

    const sidepanel = await openUnlockedPanel(extension);
    await sidepanel.locator("#account-trigger").click();
    await expect(
      sidepanel.locator(`button.drawer-account[data-switch-account="SN_MAIN:${expected.ledgerW}"]`),
    ).toBeVisible();
    // The firmware gate ran against the stand-in and restored the app, and
    // every key came from the emulated device, not the bridge.
    const answered = bridge.log.map((entry) => `${entry.answeredBy}:${entry.cla}:${entry.ins}`);
    expect(answered).toContain("dashboard:224:1");
    expect(answered).toContain(`device:${STARKNET_CLA}:1`);
    expect(bridge.location()).toBe("app");
  });
});

test("blind signing off: the device refuses and the wallet shows the combined copy", async () => {
  await withRig(async (rig) => {
    const pending = await importAndRequestSign(rig);
    try {
      await rejectBlindSigningPrompt(rig.screen, rig.speculos.model);
      // App 2.4.3 answers a hash with the setting off by showing its
      // "cannot be clear-signed" prompt, then UserCancelled (0x6985) once the
      // user backs out (starknet/src/main.rs, Ins::SignHash), the same status
      // as a reject. hw-app-starknet folds 0x6985 into ExecutionError
      // (0x6F00), so Bramble shows the copy that covers both (mc-wallet 876).
      await expect(pending.overlay.locator('p.review-flag[role="alert"]')).toHaveText(
        ledgerMessage("rejected-or-blind-signing-off"),
        { timeout: 30_000 },
      );
      expect(lastSignHashStatus(rig.bridge)).toBe(USER_CANCELLED);
      // The device was asked once: one path APDU, one refused hash APDU.
      expect(signHashStatuses(rig.bridge)).toEqual([0x9000, USER_CANCELLED]);
      await pending.overlay.locator("[data-ledger-cancel]").click();
      await expect(pending.dapp.getByTestId("sign-result")).toContainText('"status":"rejected"');
    } finally {
      await pending.server.close();
    }
  });
});

test("rejecting on the device shows the combined copy", async () => {
  await withRig(async (rig) => {
    await enableBlindSigning(rig.screen, rig.speculos.model);
    const pending = await importAndRequestSign(rig);
    try {
      await rejectHashReview(rig.screen, rig.speculos.model);
      // A reject answers UserCancelled (0x6985), indistinguishable from Blind
      // signing off, so the wallet shows the same combined copy.
      await expect(pending.overlay.locator('p.review-flag[role="alert"]')).toHaveText(
        ledgerMessage("rejected-or-blind-signing-off"),
        { timeout: 30_000 },
      );
      expect(lastSignHashStatus(rig.bridge)).toBe(USER_CANCELLED);
      expect(signHashStatuses(rig.bridge)).toEqual([0x9000, USER_CANCELLED]);
      await pending.overlay.locator("[data-ledger-cancel]").click();
      await expect(pending.dapp.getByTestId("sign-result")).toContainText('"status":"rejected"');
    } finally {
      await pending.server.close();
    }
  });
});

test("blind-signs: the wallet's hash matches the device and a signature returns", async () => {
  await withRig(async (rig) => {
    const pending = await importAndRequestSign(rig);
    try {
      const deviceScreens = await approveHashReview(rig.screen, rig.speculos.model);
      expect(comparableScreen(deviceScreens)).toContain(comparableHash(pending.hash));
      await expect(pending.dapp.getByTestId("sign-result")).toContainText('"status":"resolved"', {
        timeout: 60_000,
      });
      await expect(pending.dapp.getByTestId("sign-result")).toContainText(
        /"signature":\["0x[0-9a-f]+","0x[0-9a-f]+"\]/,
      );
      expect(lastSignHashStatus(rig.bridge)).toBe(0x9000);
    } finally {
      await pending.server.close();
    }
  });
});
