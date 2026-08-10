/**
 * Standalone browser-tab page that obtains and verifies a Ledger grant. Chrome
 * exposes its native hardware chooser only from an ordinary browser tab:
 * extension side panels and `chrome.windows.create({ type: "popup" })` windows
 * can resolve with an empty device list even when the OS sees the Ledger. Cable
 * is the primary path for every supported model; Bluetooth is an explicit
 * alternative on devices that provide it. The tab opens the user-selected
 * transport, probes the Starknet app, and retains the live session while the
 * side panel performs the current read or sign result through a validated,
 * per-session extension-origin broker. This retained ownership is required for
 * Web Bluetooth because stable Chrome cannot silently enumerate a previously
 * paired device.
 *
 * Deliberately framework-free: trusted DOM construction, the shared wallet
 * skin/scale tokens, and a narrow Chrome type surface. Selection/failure policy
 * and the app-probe session are unit-tested; this entrypoint stays the thin
 * browser/DOM boundary exercised against Chromium and physical hardware.
 */

import { LedgerRejection, ledgerMessage } from "../sidepanel/ledger/errors";
import { type LedgerTransport, newStarknetClient } from "../sidepanel/ledger/webhid-impl";
import { darkSkin } from "../ui/dark-skin";
import { applySkin } from "../ui/skin";
import { ledgerBrokerChannelName, ledgerBrokerSessionFromHash } from "./broker-protocol";
import { serveLedgerBroker } from "./broker-server";
import {
  alternateLedgerTransport,
  type LedgerConnectionMethod,
  ledgerGrantDiagnostic,
  ledgerGrantFailure,
  transportForConnectionMethod,
} from "./grant-flow";
import { probeLedgerGrantClient } from "./grant-session";
import {
  closeGrantTransport,
  type LedgerGrantTransportDiagnostics,
  type LedgerTransportKind,
  readGrantTransportDiagnostics,
  requestGrantTransport,
  supportedGrantTransportKinds,
} from "./grant-transport";
import { LEDGER_GRANT_STYLES } from "./styles";
import { ledgerTransitionProgress } from "./transition-progress";

type GrantChrome = {
  readonly tabs?: {
    readonly getCurrent: () => Promise<{ readonly id?: number } | undefined>;
    readonly remove: (tabId: number) => Promise<void>;
  };
};

type GrantGlobal = typeof globalThis & {
  readonly chrome?: GrantChrome;
  readonly close?: () => void;
};

// Closes only this hardware tab once the retained session is settled. Never
// remove the hosting browser window: doing so would close unrelated user tabs.
// Best-effort outside a real extension tab.
const closeThisTab = async (): Promise<void> => {
  const grantGlobal = globalThis as GrantGlobal;
  try {
    const tabs = grantGlobal.chrome?.tabs;
    const current = await tabs?.getCurrent();
    if (current?.id !== undefined) {
      await tabs?.remove(current.id);
      return;
    }
  } catch {
    // A successful permission grant must not be reported as a connection
    // failure merely because Chrome raced or rejected its tab-removal call.
  }
  grantGlobal.close?.();
};

const element = <Name extends keyof HTMLElementTagNameMap>(
  name: Name,
  className?: string,
): HTMLElementTagNameMap[Name] => {
  const node = document.createElement(name);
  if (className) {
    node.className = className;
  }
  return node;
};

const textElement = <Name extends keyof HTMLElementTagNameMap>(
  name: Name,
  className: string,
  text: string,
): HTMLElementTagNameMap[Name] => {
  const node = element(name, className);
  node.textContent = text;
  return node;
};

const readinessStep = (index: string, text: string): HTMLLIElement => {
  const item = element("li", "grant-step");
  item.append(textElement("span", "grant-step-index", index), textElement("strong", "", text));
  return item;
};

const ledgerVisual = (): HTMLDivElement => {
  const visual = element("div", "ledger-visual");
  visual.setAttribute("aria-hidden", "true");
  const cable = element("span", "ledger-cable");
  const body = element("div", "ledger-body");
  const screen = element("span", "ledger-screen");
  screen.append(textElement("strong", "", "Starknet"), document.createTextNode("Ready"));
  const controls = element("span", "ledger-controls");
  controls.append(element("span"), element("span"));
  body.append(screen, controls);
  visual.append(cable, body);
  return visual;
};

const transportLabel = (transport: LedgerTransportKind): string =>
  transport === "ble" ? "Bluetooth" : transport === "usb" ? "USB" : "HID";

const retryTransportLabel = (transport: LedgerTransportKind): string =>
  transport === "ble"
    ? "Try Bluetooth pairing"
    : transport === "usb"
      ? "Try USB cable"
      : "Try HID cable";

const diagnosticId = (transport: LedgerTransportKind, stage: string): string =>
  `MC-LDG-${transport.toUpperCase()}-${stage}`;

const render = (): void => {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) {
    return;
  }

  document.documentElement.style.setProperty("color-scheme", "dark");
  applySkin(darkSkin, document.documentElement);
  const style = element("style");
  style.textContent = LEDGER_GRANT_STYLES;

  const shell = element("section", "grant-shell");
  const header = element("header", "grant-header");
  const brand = element("span", "grant-brand");
  brand.append(
    textElement("span", "grant-brand-mark", "MC"),
    textElement("strong", "", "MC Wallet"),
  );
  const once = element("span", "grant-once");
  once.append(element("span", "grant-once-dot"), document.createTextNode("Secure device session"));
  header.append(brand, once);

  const hero = element("div", "grant-hero");
  const copy = element("div", "grant-copy");
  copy.append(
    textElement("h1", "", "Connect your Ledger"),
    textElement(
      "p",
      "",
      "Chrome uses this secure tab to keep the device connection alive. It closes automatically when the wallet finishes.",
    ),
  );
  hero.append(ledgerVisual(), copy);

  const methods = element("section", "grant-methods");
  methods.setAttribute("aria-labelledby", "grant-methods-title");
  const methodsTitle = textElement("p", "grant-readiness-head", "Connection method");
  methodsTitle.id = "grant-methods-title";
  const methodOptions = element("div", "grant-method-options");
  const cableMethod = element("button", "grant-method");
  cableMethod.type = "button";
  cableMethod.dataset["active"] = "true";
  cableMethod.setAttribute("aria-pressed", "true");
  cableMethod.append(
    textElement("strong", "", "USB cable"),
    textElement("span", "", "Recommended · S Plus, X, Stax, Flex, and Gen5"),
  );
  const bluetoothMethod = element("button", "grant-method");
  bluetoothMethod.type = "button";
  bluetoothMethod.setAttribute("aria-pressed", "false");
  bluetoothMethod.append(
    textElement("strong", "", "Bluetooth"),
    textElement("span", "", "Nano X, Stax, Flex, and Nano Gen5"),
  );
  methodOptions.append(cableMethod, bluetoothMethod);
  methods.append(methodsTitle, methodOptions);

  const readiness = element("section", "grant-readiness");
  readiness.setAttribute("aria-labelledby", "grant-readiness-title");
  const readinessTitle = textElement("p", "grant-readiness-head", "Before you continue");
  readinessTitle.id = "grant-readiness-title";
  const steps = element("ol", "grant-steps");
  readiness.append(readinessTitle, steps);

  const status = element("div", "grant-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const statusTitle = textElement("strong", "", "");
  const statusCopy = textElement("p", "", "");
  const statusDetail = textElement("span", "grant-diagnostic", "");
  statusDetail.hidden = true;
  status.append(statusTitle, statusCopy, statusDetail);

  const actions = element("div", "grant-actions");
  const button = element("button", "grant-button");
  button.type = "button";
  const spinner = element("span", "grant-spinner");
  spinner.setAttribute("aria-hidden", "true");
  const buttonLabel = textElement("span", "", "Connect with USB");
  button.append(spinner, buttonLabel);
  const cancel = textElement("button", "grant-cancel", "Cancel");
  cancel.type = "button";
  actions.append(button, cancel);

  const footnote = textElement(
    "p",
    "grant-footnote",
    "MC Wallet validates the Starknet app, but your keys never leave your Ledger.",
  );

  const setStatus = (
    title: string,
    message: string,
    tone: "info" | "danger" | "success" = "info",
    detail?: string,
  ): void => {
    status.hidden = false;
    status.dataset["tone"] = tone;
    statusTitle.textContent = title;
    statusCopy.textContent = message;
    statusDetail.hidden = detail === undefined;
    statusDetail.textContent = detail ?? "";
  };

  let selectedMethod: LedgerConnectionMethod = "cable";
  let nextTransport: LedgerTransportKind | null = null;
  let activeTransport: LedgerTransport | null = null;
  let activeTransportKind: LedgerTransportKind | null = null;
  let brokerChannel: BroadcastChannel | null = null;
  let stopBroker: (() => void) | null = null;
  let closing = false;
  const sessionId = ledgerBrokerSessionFromHash(globalThis.location.hash);
  const supportedTransports = supportedGrantTransportKinds();

  const renderReadiness = (): void => {
    steps.replaceChildren(
      ...(selectedMethod === "ble"
        ? [
            readinessStep("1", "Enable Bluetooth, then power your Ledger off and back on"),
            readinessStep("2", "Stay on the Ledger dashboard and pair it in Chrome"),
            readinessStep("3", "MC Wallet will check firmware, then open Starknet"),
          ]
        : [
            readinessStep("1", "Unlock your Ledger and connect a data-capable USB cable"),
            readinessStep("2", "MC Wallet will check firmware, then open Starknet"),
            readinessStep("3", "Choose your Ledger in Chrome, then click Connect"),
          ]),
    );
  };
  renderReadiness();

  const release = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    stopBroker?.();
    stopBroker = null;
    brokerChannel?.close();
    brokerChannel = null;
    const transport = activeTransport;
    const transportKind = activeTransportKind;
    activeTransport = null;
    activeTransportKind = null;
    const cleanup =
      transport && transportKind
        ? closeGrantTransport(transport).catch(() => undefined)
        : Promise.resolve();
    await closeThisTab();
    await cleanup;
  };

  globalThis.addEventListener("pagehide", () => {
    stopBroker?.();
    brokerChannel?.close();
    if (activeTransport && activeTransportKind) {
      void closeGrantTransport(activeTransport).catch(() => undefined);
    }
  });

  const resetButton = (label: string): void => {
    button.disabled = false;
    button.dataset["busy"] = "false";
    buttonLabel.textContent = label;
  };

  const selectMethod = (method: LedgerConnectionMethod): void => {
    selectedMethod = method;
    nextTransport = null;
    cableMethod.dataset["active"] = `${method === "cable"}`;
    cableMethod.setAttribute("aria-pressed", `${method === "cable"}`);
    bluetoothMethod.dataset["active"] = `${method === "ble"}`;
    bluetoothMethod.setAttribute("aria-pressed", `${method === "ble"}`);
    status.hidden = true;
    renderReadiness();
    resetButton(method === "ble" ? "Pair with Bluetooth" : "Connect with USB");
  };

  const showLedgerRejection = (error: LedgerRejection, transport: LedgerTransportKind): void => {
    const appIsClosed = error.code === "no-app-open";
    setStatus(
      appIsClosed ? "Open Starknet on your Ledger" : "Ledger isn't ready",
      ledgerMessage(error.code),
      "danger",
      `Support code · ${diagnosticId(transport, appIsClosed ? "APP" : "DEVICE")}`,
    );
    nextTransport = transport;
    resetButton(appIsClosed ? "Check Starknet again" : "Try again");
  };

  const showTransportFailure = (
    error: unknown,
    transport: LedgerTransportKind,
    supported: readonly LedgerTransportKind[],
    diagnostics: LedgerGrantTransportDiagnostics,
  ): void => {
    const failure = ledgerGrantFailure(error);
    if (failure === "permission-dismissed") {
      nextTransport = transport;
      setStatus(
        transport === "ble"
          ? "Bluetooth pairing closed"
          : `Chrome did not expose ${transportLabel(transport)}`,
        transport === "ble"
          ? "Chrome returned no compatible Ledger Bluetooth service. Choose USB above if the device is cabled."
          : transport === "hid"
            ? "Chrome returned no permitted Ledger HID collection. A Ledger that also exposes FIDO can be filtered by Chrome."
            : "Chrome returned no compatible Ledger vendor interface. Check Chrome's USB-device setting and device log; reconnecting alone may not change this.",
        "danger",
        ledgerGrantDiagnostic(diagnosticId(transport, "PICKER"), diagnostics),
      );
      resetButton(retryTransportLabel(transport));
      return;
    } else if (failure === "permission-blocked") {
      setStatus(
        "Chrome blocked device access",
        "Reconnect the Ledger and check Chrome's device permissions for MC Wallet.",
        "danger",
        ledgerGrantDiagnostic(diagnosticId(transport, "POLICY"), diagnostics),
      );
    } else if (failure === "interface-unavailable" || failure === "transport-unavailable") {
      const alternate = alternateLedgerTransport(transport, supported);
      nextTransport = alternate ?? transport;
      setStatus(
        `${transportLabel(transport)} couldn't open the Ledger`,
        alternate
          ? `Chrome could not claim that interface. Try the ${transportLabel(alternate)} compatibility transport.`
          : "Reconnect the Ledger, close other wallet apps, and try again.",
        "danger",
        ledgerGrantDiagnostic(diagnosticId(transport, "INTERFACE"), diagnostics),
      );
      resetButton(alternate ? `Try ${transportLabel(alternate)} instead` : "Try again");
      return;
    } else {
      setStatus(
        "Ledger connection failed",
        "Reconnect the cable, unlock the device, keep Starknet open, and close other wallet apps.",
        "danger",
        ledgerGrantDiagnostic(diagnosticId(transport, "TRANSPORT"), diagnostics),
      );
    }
    nextTransport = transport;
    resetButton(retryTransportLabel(transport));
  };

  const connect = async (): Promise<void> => {
    if (!sessionId) {
      return;
    }
    button.disabled = true;
    button.dataset["busy"] = "true";
    buttonLabel.textContent = "Checking browser support…";
    const supported = supportedTransports;
    const transport = transportForConnectionMethod(selectedMethod, supported, nextTransport);
    if (!transport) {
      setStatus(
        "Ledger transport unavailable",
        selectedMethod === "ble"
          ? "Bluetooth is unavailable in this browser. Connect with USB instead."
          : "Use the latest Chrome, Brave, or Edge on desktop, then try again.",
        "danger",
        "Support code · MC-LDG-BROWSER",
      );
      resetButton(selectedMethod === "ble" ? "Pair with Bluetooth" : "Connect with USB");
      return;
    }

    buttonLabel.textContent = `Waiting for ${transportLabel(transport)}…`;
    const chooserAction = transport === "ble" ? "Pair" : "Connect";
    setStatus(
      "Choose your device in Chrome",
      `Select your Ledger in Chrome's ${transportLabel(transport)} device list, then click ${chooserAction}.`,
      "info",
      `Transport · ${transportLabel(transport)}`,
    );

    try {
      if (!activeTransport) {
        activeTransport = await requestGrantTransport(transport);
        activeTransportKind = transport;
      }
      setStatus(
        "Checking firmware and Starknet",
        "MC Wallet is checking device software and reading a public account key. Nothing is signed.",
        "info",
        `Transport · ${transportLabel(transport)} · Firmware, app, and key handshake`,
      );
      const client = newStarknetClient(activeTransport, (phase) => {
        const { message, title } = ledgerTransitionProgress(phase);
        buttonLabel.textContent = title;
        setStatus(title, message, "info", `Transport · ${transportLabel(transport)}`);
      });
      const version = await probeLedgerGrantClient(client);
      brokerChannel = new BroadcastChannel(ledgerBrokerChannelName(sessionId));
      stopBroker = serveLedgerBroker(brokerChannel, client, () => {
        void release();
      });
      setStatus(
        "Ledger connected",
        `Starknet ${version.major}.${version.minor}.${version.patch} verified. MC Wallet is ready to continue.`,
        "success",
        `Transport · ${transportLabel(transport)} · Secure session active`,
      );
      button.dataset["busy"] = "false";
      buttonLabel.textContent = "Connected";
      cancel.textContent = "Disconnect";
    } catch (error) {
      if (error instanceof LedgerRejection) {
        if (error.code !== "no-app-open" && error.code !== "device-locked") {
          const failedTransport = activeTransport;
          const failedTransportKind = activeTransportKind;
          activeTransport = null;
          activeTransportKind = null;
          if (failedTransport && failedTransportKind) {
            await closeGrantTransport(failedTransport).catch(() => undefined);
          }
        }
        showLedgerRejection(error, transport);
        return;
      }
      const failedTransport = activeTransport;
      const failedTransportKind = activeTransportKind;
      activeTransport = null;
      activeTransportKind = null;
      if (failedTransport && failedTransportKind) {
        await closeGrantTransport(failedTransport).catch(() => undefined);
      }
      const methodTransports = supported.filter((kind) =>
        selectedMethod === "ble" ? kind === "ble" : kind !== "ble",
      );
      const diagnostics = await readGrantTransportDiagnostics(transport);
      showTransportFailure(error, transport, methodTransports, diagnostics);
    }
  };

  button.addEventListener("click", () => {
    void connect();
  });
  cableMethod.addEventListener("click", () => {
    selectMethod("cable");
  });
  bluetoothMethod.addEventListener("click", () => {
    selectMethod("ble");
  });

  cancel.addEventListener("click", () => {
    void release();
  });

  if (!sessionId) {
    button.disabled = true;
    setStatus(
      "Open Ledger from MC Wallet",
      "This hardware tab needs a fresh secure session from the wallet.",
      "danger",
      "Support code · MC-LDG-SESSION",
    );
  }

  shell.append(header, hero, methods, readiness, status, actions, footnote);
  app.replaceChildren(style, shell);
};

render();
