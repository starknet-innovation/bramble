/**
 * Standalone browser-tab page that connects a paired phone over Bluetooth.
 *
 * Chrome exposes its device chooser only from an ordinary tab. That was measured
 * for Bluetooth specifically, not inherited from the Ledger flow's finding: in
 * the side panel `requestDevice` rejects with `NotFoundError` in single-digit
 * milliseconds with no chooser shown, while `getAvailability()` reports a healthy
 * adapter. Stable Chrome also exposes no `Bluetooth.getDevices()`, and a
 * `BluetoothDevice` cannot be structured-cloned to another realm, so the tab that
 * ran the chooser is the only context that can hold the connection. It therefore
 * keeps it for the current operation and serves the side panel through a
 * validated, per-session extension-origin broker.
 *
 * Deliberately framework-free: trusted DOM construction and a narrow Chrome type
 * surface. Every decision worth testing lives behind this file — the framing in
 * `pq-transport/framing`, the channel policy in `pq-transport/broker-server` —
 * so this entrypoint stays the thin browser boundary that needs a real phone.
 */

import { servePqBroker } from "@mc-wallet/pq-transport/broker-server";
import { asPqRejection, pqMessage } from "@mc-wallet/pq-transport/errors";
import {
  connectPqDevice,
  isPqBluetoothAvailable,
  type PqConnection,
  pqDeviceFrom,
  requestPqDevice,
} from "@mc-wallet/pq-transport/gatt";
import { pqBrokerChannelName, pqBrokerSessionFromHash } from "@mc-wallet/pq-transport/protocol";
import { darkSkin } from "@mc-wallet/ui-kit/dark-skin";
import { applySkin } from "@mc-wallet/ui-kit/skin";
import { PQ_GRANT_STYLES } from "./styles";

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

// Closes only this tab once the session is settled. Never the hosting window:
// that would take unrelated user tabs with it.
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
    // A working connection must not be reported as a failure because Chrome
    // raced or refused its own tab-removal call.
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

const step = (index: string, text: string): HTMLLIElement => {
  const item = element("li", "pq-step");
  item.append(textElement("span", "pq-step-index", index), textElement("strong", "", text));
  return item;
};

const render = (): void => {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) {
    return;
  }

  document.documentElement.style.setProperty("color-scheme", "dark");
  applySkin(darkSkin, document.documentElement);
  const style = element("style");
  style.textContent = PQ_GRANT_STYLES;

  const shell = element("section", "pq-shell");
  const header = element("header", "pq-header");
  const brand = element("span", "pq-brand");
  brand.append(textElement("span", "pq-brand-mark", "MC"), textElement("strong", "", "MC Wallet"));
  header.append(brand, textElement("span", "pq-once", "Secure device session"));

  const copy = element("div", "pq-copy");
  copy.append(
    textElement("h1", "", "Connect your phone"),
    textElement(
      "p",
      "",
      "Chrome uses this tab to keep the Bluetooth connection alive. It closes automatically when the wallet finishes.",
    ),
  );

  const readiness = element("ol", "pq-steps");
  readiness.append(
    step("1", "Open Signer 3000 on your phone and keep it on screen"),
    step("2", "Choose your phone in Chrome's list, then click Connect"),
    step("3", "Approve the request when the phone shows it"),
  );

  const status = element("div", "pq-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  const statusTitle = textElement("strong", "", "");
  const statusCopy = textElement("p", "", "");
  status.append(statusTitle, statusCopy);

  const actions = element("div", "pq-actions");
  const button = element("button", "pq-button");
  button.type = "button";
  const buttonLabel = textElement("span", "", "Connect over Bluetooth");
  button.append(buttonLabel);
  const cancel = textElement("button", "pq-cancel", "Cancel");
  cancel.type = "button";
  actions.append(button, cancel);

  const setStatus = (title: string, message: string, tone: "info" | "danger" | "success"): void => {
    status.hidden = false;
    status.dataset["tone"] = tone;
    statusTitle.textContent = title;
    statusCopy.textContent = message;
  };

  let connection: PqConnection | null = null;
  let brokerChannel: BroadcastChannel | null = null;
  let stopBroker: (() => void) | null = null;
  let closing = false;
  const sessionId = pqBrokerSessionFromHash(globalThis.location.hash);

  const release = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    stopBroker?.();
    stopBroker = null;
    brokerChannel?.close();
    brokerChannel = null;
    connection?.close();
    connection = null;
    await closeThisTab();
  };

  globalThis.addEventListener("pagehide", () => {
    stopBroker?.();
    brokerChannel?.close();
    connection?.close();
  });

  const connect = (): void => {
    if (!sessionId || connection) {
      return;
    }
    if (!isPqBluetoothAvailable()) {
      setStatus(
        "Bluetooth is unavailable",
        "This browser exposes no Web Bluetooth. In Brave it is behind a flag in brave://flags; otherwise use the latest Chrome on desktop.",
        "danger",
      );
      return;
    }
    button.disabled = true;
    buttonLabel.textContent = "Waiting for Chrome...";
    setStatus(
      "Choose your phone in Chrome",
      "Pick the phone running Signer 3000, then click Connect. If the list is empty, bring the app back to the front — it advertises only while on screen.",
      "info",
    );

    // requestDevice() runs synchronously off this click. Chrome drops transient
    // activation across an await, and the symptom is a chooser that never
    // appears — so nothing may be awaited before it.
    const chosen = requestPqDevice();
    void chosen
      .then(async (device) => {
        setStatus("Connecting", "Opening the signer service on your phone.", "info");
        const opened = await connectPqDevice(device);
        connection = opened;
        brokerChannel = new BroadcastChannel(pqBrokerChannelName(sessionId));
        stopBroker = servePqBroker(brokerChannel, pqDeviceFrom(opened), () => {
          void release();
        });
        setStatus(
          "Phone connected",
          `${device.name ?? "Your phone"} is connected. MC Wallet is ready to continue.`,
          "success",
        );
        buttonLabel.textContent = "Connected";
        cancel.textContent = "Disconnect";
      })
      .catch((error: unknown) => {
        const rejection = asPqRejection(error);
        setStatus("Couldn't connect", pqMessage(rejection.code), "danger");
        button.disabled = false;
        buttonLabel.textContent = "Try again";
      });
  };

  button.addEventListener("click", connect);
  cancel.addEventListener("click", () => {
    void release();
  });

  if (!sessionId) {
    button.disabled = true;
    setStatus(
      "Open this from MC Wallet",
      "This device tab needs a fresh secure session from the wallet.",
      "danger",
    );
  }

  shell.append(header, copy, readiness, status, actions);
  app.replaceChildren(style, shell);
};

render();
