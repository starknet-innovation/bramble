/**
 * That the Bluetooth controls are actually wired.
 *
 * This exists because they were not. The enrollment listener was attached inside
 * the cancel handler, so the button rendered, passed every view test, and did
 * nothing when clicked — and the controller tests could not see it, because they
 * drive the controller directly and never touch a button.
 *
 * Both mounts are also different in a way worth pinning: the enrollment controls
 * live inside a `<form>`, so a handler that forgets `preventDefault` submits the
 * form instead of running, while the sign overlay is a plain section.
 *
 * The last test pins WHICH operation each overlay is given, which was the second
 * bug: enrollment was wired to `sign` and signing to `pair`. Both buttons worked,
 * both called the transport, and the frames went out with the wrong tag — so the
 * phone answered a pairing offer with a complaint about a missing correlation id.
 * Only a test that distinguishes the two operations can see that.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createDeviceOverlays } from "../../../../src/sidepanel/app/devices/device-overlays";
import { createMobilePqOnboardRuntime } from "../../../../src/sidepanel/journeys/mobile/onboard-runtime";
import { createMobilePqSignRuntime } from "../../../../src/sidepanel/journeys/mobile/sign-runtime";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const status = {
  network: "Starknet Devnet",
  networkId: "SN_DEVNET",
  networks: [{ id: "SN_DEVNET", name: "Starknet Devnet" }],
  ready: true,
} as never;

const request = {
  accountId: "SN_DEVNET:0x1",
  deviceId: "Pixel 8 Pro",
  id: "queued-1",
  messageHash: "0x2f",
  networkId: "SN_DEVNET",
  publicKey: `0x${"ab".repeat(1952)}`,
} as never;

describe("paired-phone Bluetooth controls", () => {
  beforeEach(() => {
    GlobalRegistrator.register();
    document.body.innerHTML = `<div id="ledger-sign-overlay"></div><div id="ledger-onboard-overlay"></div>`;
  });

  afterEach(() => {
    GlobalRegistrator.unregister();
  });

  test("the sign overlay's button reaches the transport", async () => {
    const sent: string[] = [];
    const mount = document.querySelector<HTMLElement>("#ledger-sign-overlay");
    if (!mount) {
      throw new Error("no mount");
    }
    const runtime = createMobilePqSignRuntime({
      bluetooth: async (envelope) => {
        sent.push(envelope);
        return `0x${"cd".repeat(3309)}`;
      },
      mount,
      status: () => status,
      wallet: {
        completeMobilePqSign: async () => undefined,
        loadMobilePqSignPending: async () => [request],
      } as never,
    });

    await runtime.poll();
    mount.querySelector<HTMLButtonElement>("[data-mobile-pq-bluetooth]")?.click();
    await tick();

    expect(sent).toHaveLength(1);
    // The envelope the phone reads, not a hash or an id.
    expect(sent[0]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("the enrollment button reaches the transport instead of submitting its form", async () => {
    const sent: string[] = [];
    const mount = document.querySelector<HTMLElement>("#ledger-onboard-overlay");
    if (!mount) {
      throw new Error("no mount");
    }
    const runtime = createMobilePqOnboardRuntime({
      bluetooth: async (offer) => {
        sent.push(offer);
        // Refused, so nothing is enrolled: this test is about the wiring.
        return "not-a-pairing-reply";
      },
      mount,
      networkId: () => "SN_DEVNET",
      refresh: async () => undefined,
      status: () => status,
      wallet: {
        addMobilePqAccount: async () => "SN_DEVNET:0x1",
        loadMobilePqEnrollChallenge: async () => `0x${"11".repeat(32)}`,
      } as never,
    });

    await runtime.open();
    const button = mount.querySelector<HTMLButtonElement>("[data-mobile-pq-enroll-bluetooth]");
    expect(button).not.toBeNull();
    button?.click();
    await tick();

    expect(sent).toHaveLength(1);
  });
});

describe("which operation each overlay is given", () => {
  beforeEach(() => {
    GlobalRegistrator.register();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    GlobalRegistrator.unregister();
  });

  test("enrollment sends a pairing offer and signing sends an envelope", async () => {
    const called: string[] = [];
    const overlays = createDeviceOverlays({
      ledgerConnector: { openConnected: async () => null, request: async () => ({}) } as never,
      mobilePqBluetooth: {
        pair: async () => {
          called.push("pair");
          return "refused";
        },
        restore: async (drive) => {
          called.push("restore");
          return drive({ restore: async () => "refused", restoreKey: async () => "refused" });
        },
        sign: async () => {
          called.push("sign");
          return "refused";
        },
      },
      networkId: () => "SN_DEVNET",
      onLedgerSignatureReported: () => undefined,
      refresh: async () => undefined,
      status: () => status,
      wallet: {
        addMobilePqAccount: async () => "SN_DEVNET:0x1",
        completeMobilePqSign: async () => undefined,
        loadMobilePqEnrollChallenge: async () => `0x${"11".repeat(32)}`,
        loadMobilePqSignPending: async () => [request],
      } as never,
    });

    await overlays.mobilePqOnboard.open();
    document.querySelector<HTMLButtonElement>("[data-mobile-pq-enroll-bluetooth]")?.click();
    await tick();
    expect(called).toEqual(["pair"]);

    await overlays.mobilePqSign.poll();
    document.querySelector<HTMLButtonElement>("[data-mobile-pq-bluetooth]")?.click();
    await tick();
    expect(called).toEqual(["pair", "sign"]);
  });
});
