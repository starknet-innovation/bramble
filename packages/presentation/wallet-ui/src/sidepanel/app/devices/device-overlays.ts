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
 * Collaborators the overlays need from the panel shell.
 */
export type DeviceOverlayDeps = {
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
    mount: overlayMount("ledger-onboard-overlay"),
    networkId: deps.networkId,
    refresh: deps.refresh,
    status: deps.status,
    wallet: deps.wallet,
  }),
  mobilePqSign: createMobilePqSignRuntime({
    mount: overlayMount("ledger-sign-overlay"),
    status: deps.status,
    wallet: deps.wallet,
  }),
});
