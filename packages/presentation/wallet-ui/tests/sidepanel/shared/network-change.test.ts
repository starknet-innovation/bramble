/**
 * The network-change announcement the paint loop makes, and the listener a
 * network-scoped form installs: the first network seen is no change, a repeat
 * is no change, and a form a repaint replaced stops listening.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  networkChangeAnnouncer,
  onNetworkChange,
} from "../../../src/sidepanel/shared/network-change";
import { registerDom, unregisterDom } from "../../support/groups-harness";

beforeAll(registerDom);
afterAll(unregisterDom);

const mounted = () => {
  document.body.replaceChildren();
  const app = document.createElement("main");
  const form = document.createElement("form");
  app.append(form);
  document.body.append(app);
  let heard = 0;
  onNetworkChange(app, form, () => {
    heard += 1;
  });
  return { announce: networkChangeAnnouncer(app), form, heard: () => heard };
};

describe("network change announcements", () => {
  test("only a different network after the first is a change", () => {
    const flow = mounted();
    flow.announce("SN_MAIN");
    expect(flow.heard()).toBe(0);
    flow.announce("SN_MAIN");
    expect(flow.heard()).toBe(0);
    flow.announce("SN_SEPOLIA");
    expect(flow.heard()).toBe(1);
    flow.announce("SN_MAIN");
    expect(flow.heard()).toBe(2);
  });

  test("a form no longer in the document is not called", () => {
    const flow = mounted();
    flow.announce("SN_MAIN");
    flow.form.remove();
    flow.announce("SN_SEPOLIA");
    flow.announce("SN_MAIN");
    expect(flow.heard()).toBe(0);
  });

  test("no root or no form is a no-op", () => {
    expect(() => networkChangeAnnouncer(null)("SN_MAIN")).not.toThrow();
    expect(() => onNetworkChange(null, null, () => undefined)).not.toThrow();
  });
});
