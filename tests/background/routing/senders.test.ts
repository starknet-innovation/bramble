/**
 * Runtime sender checks prove extension-page trust requires the owning extension id.
 */
import { describe, expect, test } from "bun:test";
import {
  isExtensionPageSender,
  isSenderOrigin,
  isTrustedSender,
  type RuntimeSender,
  senderUrlOrigin,
} from "../../../apps/extension/src/background/routing/senders";
import { chromiumExtension } from "../../support/background-wallet-stub";

const extensionId = "extension-id";
const extensionPage: RuntimeSender = {
  id: extensionId,
  url: "chrome-extension://extension-id/popup.html",
};
const contentScript: RuntimeSender = {
  id: extensionId,
  url: "https://example.com/app",
};

describe("runtime sender trust", () => {
  test("reads sender URL origins exactly", () => {
    expect(senderUrlOrigin(extensionPage)).toBe("chrome-extension://extension-id");
    expect(senderUrlOrigin({ url: "not-a-url" })).toBeNull();
  });

  // Firefox serves extension pages from `moz-extension://<per-install uuid>`
  // while `runtime.id` is the add-on id from `browser_specific_settings`. The
  // gate used to synthesize `moz-extension://<add-on id>`, which matches
  // nothing, so every privileged message from the sidebar, popup and
  // onboarding page was refused as an untrusted sender. The identity carries
  // both values because neither can be derived from the other.
  test("trusts a gecko page whose origin is unrelated to the add-on id", () => {
    const gecko = {
      id: "bramble@starknet.org",
      origin: "moz-extension://3f2a9c1e-8b4d-4a77-9f0e-2c5d6e7a8b90",
    };
    expect(
      isExtensionPageSender(
        {
          id: "bramble@starknet.org",
          url: "moz-extension://3f2a9c1e-8b4d-4a77-9f0e-2c5d6e7a8b90/sidepanel.html",
        },
        gecko,
      ),
    ).toBe(true);
  });

  test("refuses a gecko sender whose page origin belongs to another install", () => {
    const gecko = {
      id: "bramble@starknet.org",
      origin: "moz-extension://3f2a9c1e-8b4d-4a77-9f0e-2c5d6e7a8b90",
    };
    expect(
      isExtensionPageSender(
        {
          id: "bramble@starknet.org",
          url: "moz-extension://00000000-0000-4000-8000-000000000000/sidepanel.html",
        },
        gecko,
      ),
    ).toBe(false);
  });

  // An origin the runtime could not supply must fail the gate, never open it.
  test("refuses every sender when the extension origin is unknown", () => {
    expect(
      isExtensionPageSender(
        { id: "extension-id", url: "chrome-extension://extension-id/popup.html" },
        { id: "extension-id", origin: "" },
      ),
    ).toBe(false);
  });

  test("trusts extension pages only when origin and extension id match", () => {
    expect(isExtensionPageSender(extensionPage, chromiumExtension(extensionId))).toBe(true);
    expect(
      isExtensionPageSender(
        {
          id: "other-extension",
          url: "chrome-extension://extension-id/popup.html",
        },
        chromiumExtension(extensionId),
      ),
    ).toBe(false);
    expect(
      isExtensionPageSender(
        {
          id: extensionId,
          origin: "chrome-extension://extension-id",
          url: "https://example.com/app",
        },
        chromiumExtension(extensionId),
      ),
    ).toBe(false);
  });

  test("trusts this extension content script without granting page privileges", () => {
    expect(isTrustedSender(contentScript, extensionId)).toBe(true);
    expect(isExtensionPageSender(contentScript, chromiumExtension(extensionId))).toBe(false);
  });

  test("matches content sender origins only when every origin signal agrees", () => {
    expect(isSenderOrigin(contentScript, "https://example.com")).toBe(true);
    expect(
      isSenderOrigin(
        {
          id: extensionId,
          origin: "https://evil.example",
          url: "https://example.com/app",
        },
        "https://example.com",
      ),
    ).toBe(false);
  });

  test("does not trust senders when extension id is missing", () => {
    expect(isTrustedSender({ id: "" }, "")).toBe(false);
    expect(
      isExtensionPageSender(
        { id: "", url: "chrome-extension:///popup.html" },
        chromiumExtension(""),
      ),
    ).toBe(false);
  });

  test("does not trust senders without an origin signal", () => {
    expect(isTrustedSender({ id: extensionId }, extensionId)).toBe(false);
    expect(isTrustedSender({ id: extensionId, origin: "https://example.com" }, extensionId)).toBe(
      true,
    );
  });
});
