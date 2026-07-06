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
} from "../src/background/senders";

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

  test("trusts extension pages only when origin and extension id match", () => {
    expect(isExtensionPageSender(extensionPage, extensionId)).toBe(true);
    expect(
      isExtensionPageSender(
        {
          id: "other-extension",
          url: "chrome-extension://extension-id/popup.html",
        },
        extensionId,
      ),
    ).toBe(false);
    expect(
      isExtensionPageSender(
        {
          id: extensionId,
          origin: "chrome-extension://extension-id",
          url: "https://example.com/app",
        },
        extensionId,
      ),
    ).toBe(false);
  });

  test("trusts this extension content script without granting page privileges", () => {
    expect(isTrustedSender(contentScript, extensionId)).toBe(true);
    expect(isExtensionPageSender(contentScript, extensionId)).toBe(false);
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
    expect(isExtensionPageSender({ id: "", url: "chrome-extension:///popup.html" }, "")).toBe(
      false,
    );
  });
});
