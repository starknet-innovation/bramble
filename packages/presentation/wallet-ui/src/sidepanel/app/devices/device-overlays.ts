/**
 * The panel's external-device overlays, created together.
 *
 * All three live outside `#app` so a dashboard repaint never resets them: a
 * device prompt must survive balances streaming in, and an enrollment form must
 * survive it while the user is away pasting into another application. Grouping
 * them here keeps the side-panel composition root inside its size budget and
 * gives one place to add a device kind.
 *
 * Holds nothing secret: each overlay carries public keys, public device
 * responses, and coordination state only.
 */

import type { WalletStatus } from "../../../popup/responses/responses";
import {
  createLedgerSignRuntime,
  type LedgerSignRuntime,
} from "../../journeys/ledger/sign-runtime";
import type { LedgerConnector } from "../../journeys/ledger/sign-session";
import {
  createMobilePqOnboardRuntime,
  type MobilePqOnboardRuntime,
} from "../../journeys/mobile/onboard-runtime";
import {
  createMobilePqSignRuntime,
  type MobilePqSignRuntime,
} from "../../journeys/mobile/sign-runtime";
import type { SidepanelWallet } from "../../runtime/runtime";
import { overlayMount } from "../../shared/dom";

/**
 * The paired-phone Bluetooth transport, as the panel uses it: one call per
 * operation, each returning the string the phone sent back. Rejections arrive as
 * ordinary `Error`s carrying user-facing copy, because translating a transport
 * code is the composition root's job — this package never learns its vocabulary.
 */
export type MobilePqBluetooth = {
  readonly pair: (offer: string) => Promise<string>;
  readonly sign: (envelope: string) => Promise<string>;
};

/**
 * Collaborators the overlays need from the panel shell.
 */
export type DeviceOverlayDeps = {
  /**
   * Carries one paired-phone envelope over Bluetooth. Injected from the
   * extension root, because opening the device tab needs `chrome.tabs` and the
   * presentation package must not reach for it itself.
   */
  readonly mobilePqBluetooth?: MobilePqBluetooth;
  readonly ledgerConnector: LedgerConnector;
  /** Marks a wallet transfer authorized once a Ledger reports its signature. */
  readonly onLedgerSignatureReported: () => void;
  /** The network a newly enrolled account is created under. */
  readonly networkId: () => string;
  /** Reloads the shell so a newly enrolled account appears. */
  readonly refresh: () => Promise<void>;
  readonly status: () => WalletStatus;
  readonly wallet: SidepanelWallet;
};

/**
 * The device overlays the panel drives: two sign takeovers polled from the
 * render cycle, and the post-quantum enrollment journey opened on demand.
 */
export type DeviceOverlays = {
  readonly ledgerSign: LedgerSignRuntime;
  readonly mobilePqOnboard: MobilePqOnboardRuntime;
  readonly mobilePqSign: MobilePqSignRuntime;
};

/**
 * Creates every device overlay over its own hidden mount.
 */
export const createDeviceOverlays = (deps: DeviceOverlayDeps): DeviceOverlays => ({
  ledgerSign: createLedgerSignRuntime({
    connector: deps.ledgerConnector,
    mount: overlayMount("ledger-sign-overlay"),
    onSignatureReported: deps.onLedgerSignatureReported,
    status: deps.status,
    wallet: deps.wallet,
  }),
  mobilePqOnboard: createMobilePqOnboardRuntime({
    // Enrollment sends a pairing offer, so it takes `pair`. Getting these two
    // the wrong way round tags the frame wrongly and the phone rejects it with a
    // message about the OTHER message type, which is a confusing way to find out.
    ...(deps.mobilePqBluetooth === undefined ? {} : { bluetooth: deps.mobilePqBluetooth.pair }),
    mount: overlayMount("ledger-onboard-overlay"),
    networkId: deps.networkId,
    refresh: deps.refresh,
    status: deps.status,
    wallet: deps.wallet,
  }),
  mobilePqSign: createMobilePqSignRuntime({
    ...(deps.mobilePqBluetooth === undefined ? {} : { bluetooth: deps.mobilePqBluetooth.sign }),
    mount: overlayMount("ledger-sign-overlay"),
    status: deps.status,
    wallet: deps.wallet,
  }),
});
