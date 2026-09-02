/**
 * That an enrolled phone's account carries the name the user typed on the phone.
 *
 * The name travels in the pairing reply and reached the account record as
 * `derivation.deviceId`, where nothing displayed it: the panel names an account
 * from the label preference, falling back to a nickname derived from the
 * address. So the phone said "Michael's Pixel" and the wallet said "Swift
 * Otter" about the same account, on the one screen where the user is being
 * asked to compare the two devices.
 *
 * The second test pins the ordering that makes this safe to do at all. The
 * account is already stored and spendable when the label is written, so a
 * failed write must leave the enrollment successful — reporting it as "that
 * device could not be added" would invite the user to enrol a duplicate.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createMobilePqOnboardRuntime } from "../../../../src/sidepanel/journeys/mobile/onboard-runtime";
import { toBase64Url } from "../../../../src/sidepanel/journeys/mobile/wire-encoding";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const status = {
  network: "Starknet Devnet",
  networkId: "SN_DEVNET",
  networks: [{ id: "SN_DEVNET", name: "Starknet Devnet" }],
  ready: true,
} as never;

const DEVICE_NAME = "Michael's Pixel";
const ACCOUNT_ID = "SN_DEVNET:0x1";

// What the phone sends back: the name it gave the key, the public key, and the
// signature over the challenge. Lengths matter — the controller refuses a reply
// whose key or signature is not exactly ML-DSA-65 shaped.
const pairingReply = (deviceId: string): string =>
  toBase64Url(
    JSON.stringify({
      deviceId,
      publicKey: `0x${"ab".repeat(1952)}`,
      signature: `0x${"cd".repeat(3309)}`,
      version: 1,
    }),
  );

const enrolOverBluetooth = async (wallet: unknown): Promise<void> => {
  const mount = document.querySelector<HTMLElement>("#ledger-onboard-overlay");
  if (!mount) {
    throw new Error("no mount");
  }
  const runtime = createMobilePqOnboardRuntime({
    bluetooth: async () => pairingReply(DEVICE_NAME),
    mount,
    networkId: () => "SN_DEVNET",
    refresh: async () => undefined,
    status: () => status,
    wallet: wallet as never,
  });
  await runtime.open();
  mount.querySelector<HTMLButtonElement>("[data-mobile-pq-enroll-bluetooth]")?.click();
  await tick();
};

describe("naming an enrolled phone's account", () => {
  beforeEach(() => {
    GlobalRegistrator.register();
    document.body.innerHTML = `<div id="ledger-onboard-overlay"></div>`;
  });

  afterEach(() => {
    GlobalRegistrator.unregister();
  });

  test("the account takes the name the user gave the key on their phone", async () => {
    const labelled: Array<readonly [string, string]> = [];
    await enrolOverBluetooth({
      addMobilePqAccount: async () => ACCOUNT_ID,
      loadMobilePqEnrollChallenge: async () => `0x${"11".repeat(32)}`,
      setAccountLabel: async (accountId: string, label: string) => {
        labelled.push([accountId, label]);
      },
    });

    // Against the id the enrollment returned, not the address or the device id:
    // the label preference is keyed by account id.
    expect(labelled).toEqual([[ACCOUNT_ID, DEVICE_NAME]]);
  });

  test("a label that will not save still leaves the account enrolled", async () => {
    const mount = document.querySelector<HTMLElement>("#ledger-onboard-overlay");
    if (!mount) {
      throw new Error("no mount");
    }
    await enrolOverBluetooth({
      addMobilePqAccount: async () => ACCOUNT_ID,
      loadMobilePqEnrollChallenge: async () => `0x${"11".repeat(32)}`,
      setAccountLabel: async () => {
        throw new Error("storage is full");
      },
    });

    // The journey closed on success, so the overlay is empty rather than
    // showing the refusal copy over a challenge that has already been spent.
    expect(mount.innerHTML).not.toContain("That device could not be added");
    expect(mount.innerHTML).not.toContain("storage is full");
    expect(mount.hidden).toBe(true);
  });
});
