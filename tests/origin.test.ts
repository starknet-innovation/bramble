/**
 * Origin policy checks keep dapp permissions aligned with the extension manifest.
 */
import { expect, test } from "bun:test";
import { isWalletOrigin, normalizeWalletOrigin } from "../src/shared/origin";

test("wallet origins allow HTTPS and local development pages only", () => {
  expect(normalizeWalletOrigin("https://example.com/path")).toBe("https://example.com");
  expect(normalizeWalletOrigin("http://localhost:5173/app")).toBe("http://localhost:5173");
  expect(normalizeWalletOrigin("http://127.0.0.1:5173/app")).toBe("http://127.0.0.1:5173");
  expect(normalizeWalletOrigin("https://user:pass@example.com/path")).toBeNull();
  expect(normalizeWalletOrigin("http://example.com")).toBeNull();
  expect(normalizeWalletOrigin("chrome-extension://extension-id/popup.html")).toBeNull();

  expect(isWalletOrigin("https://example.com")).toBe(true);
  expect(isWalletOrigin("https://example.com/path")).toBe(false);
});
