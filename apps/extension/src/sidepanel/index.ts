/**
 * Browser-owned side-panel composition root. Hardware access is injected into
 * the presentation package so UI code cannot instantiate transports itself.
 *
 * The paired-phone Bluetooth transport is built here for the same reason: it
 * opens a top-level tab, which needs `chrome.tabs`, and it mints the session
 * capability that names the broker channel. Neither belongs in the presentation
 * package, and both are absent outside a Chromium extension page — in which case
 * nothing is passed and the sign prompt offers only its copy-and-paste path.
 */
import { ledgerConnector } from "@mc-wallet/ledger-browser/connector";
import { asPqRejection, pqMessage } from "@mc-wallet/pq-transport/errors";
import {
  PQ_READY_TIMEOUT,
  type PqDeviceSession,
  pqExtensionBrowser,
  requestPqDeviceSession,
} from "@mc-wallet/pq-transport/grant-window";
import { startWalletUi } from "@mc-wallet/wallet-ui/start";

type ExtensionGlobal = typeof globalThis & {
  readonly chrome?: Parameters<typeof startWalletUi>[1];
};

// Read off the port rather than imported: `@mc-wallet/wallet-ui` exports only
// `./start`, and taking the shape from the parameter it is passed as means the
// implementation below is checked against the declaration the panel actually
// uses instead of a second copy that could drift from it.
type MobilePqBluetoothPort = NonNullable<Parameters<typeof startWalletUi>[2]>;

// Must be the same bound the background sign queue uses (MOBILE_PQ_SIGN_TIMEOUT
// in background/routing/message-context.ts). A transport that gives up while the
// queue still waits leaves the request parked with the user told it timed out;
// longer, and the two race. `requestPqDeviceSession` takes it with no default so
// the pair cannot silently disagree.
const MOBILE_PQ_COMMAND_TIMEOUT = {
  ms: 900_000,
  schedule: (onElapsed: () => void, ms: number) => {
    const handle = setTimeout(onElapsed, ms);
    return () => clearTimeout(handle);
  },
};

// One device tab per operation: opened, used, and closed. Retaining it was
// spiked on the Ledger path and deliberately dropped — stable Chrome exposes no
// `Bluetooth.getDevices()`, so the chooser runs either way, and a retained tab
// needs a lifecycle this flow does not have.
//
// The rejection is translated here, and this is the only place that can: the
// presentation package renders `error.message`, and a `PqRejection` carries its
// CODE there, so without this the user would read "rejected-on-device". The
// panel stays ignorant of the transport's vocabulary, which is the point of the
// seam.
const withPqSession = async <T>(use: (session: PqDeviceSession) => Promise<T>): Promise<T> => {
  const browser = pqExtensionBrowser();
  if (!browser) {
    throw new Error(pqMessage("bluetooth-unavailable"));
  }
  const session = await requestPqDeviceSession(browser, {
    channel: (name) => new BroadcastChannel(name),
    command: MOBILE_PQ_COMMAND_TIMEOUT,
    ready: PQ_READY_TIMEOUT,
    sessionId: () => crypto.randomUUID(),
  }).catch((error: unknown) => {
    throw new Error(pqMessage(asPqRejection(error).code));
  });
  try {
    return await use(session);
  } finally {
    await session.close();
  }
};

const overBluetooth = (use: (session: PqDeviceSession) => Promise<string>): Promise<string> =>
  withPqSession(async (session) => {
    try {
      return await use(session);
    } catch (error) {
      throw new Error(pqMessage(asPqRejection(error).code));
    }
  });

/** Translates one device call, leaving the caller free to carry on after it. */
const translated =
  (call: (offer: string) => Promise<string>) =>
  async (offer: string): Promise<string> => {
    try {
      return await call(offer);
    } catch (error) {
      throw new Error(pqMessage(asPqRejection(error).code));
    }
  };

// Restore holds ONE session open across every account, which is why it takes a
// driver rather than a payload: the chooser runs once, and the panel then asks
// the phone for the accounts the user picked one at a time over that same
// connection. Translation is per call rather than around the whole drive,
// because a refusal is reported beside the account it belongs to and must not
// end the run — the remaining accounts still restore.
const overBluetoothRestore: MobilePqBluetoothPort["restore"] = (drive) =>
  withPqSession((session) =>
    drive({
      restore: translated(session.restore),
      restoreKey: translated(session.restoreKey),
    }),
  );

const mobilePqBluetooth = {
  pair: (offer: string) => overBluetooth((session) => session.pair(offer)),
  restore: overBluetoothRestore,
  sign: (envelope: string) => overBluetooth((session) => session.sign(envelope)),
};

await startWalletUi(
  ledgerConnector,
  (globalThis as ExtensionGlobal).chrome,
  pqExtensionBrowser() ? mobilePqBluetooth : undefined,
);
