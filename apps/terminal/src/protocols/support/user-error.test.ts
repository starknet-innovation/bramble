/**
 * Conformance for the terminal's error copy (mc-wallet issue 652).
 *
 * Scans every error the terminal's own sources construct with a literal
 * message, runs it through `userErrorMessage`, and holds three properties:
 * plumbing never comes out as written, a security or cryptographic fact always
 * does, and every other message is one somebody decided a reader may see. A new
 * thrown string fails the last test until it is classified.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VesuMultiplyAnchorError } from "../vesu/vesu-multiply-anchor";
import { VESU_REGISTRY_UNAVAILABLE, VESU_UNREGISTERED } from "../vesu/vesu-anchors";
import { VESU_VAULT_DEPOSITS_PAUSED } from "../vesu/vesu-actions";
import { ResponseTooLargeError } from "./bounded-network";
import { HttpError } from "../../data/core/client";
import { WalletError } from "./errors";
import { isFactMessage, isInternalMessage, userErrorMessage } from "./user-error";

const FALLBACK = "Vesu request failed.";
const SRC = join(import.meta.dirname, "../..");

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\./.test(entry) ? [path] : [];
  });

// `new X("…")` and `new X(`…`)`; a template's placeholders become "x" so the
// head of the message is still classified.
const CONSTRUCTED = /new\s+[A-Z]\w*\(\s*(?:"([^"]+)"|`([^`]+)`)/g;

const thrownMessages = (): ReadonlySet<string> => {
  const found = new Set<string>();
  for (const file of sources(SRC)) {
    for (const match of readFileSync(file, "utf8").matchAll(CONSTRUCTED)) {
      const value = (match[1] ?? match[2] ?? "").replace(/\$\{[^}]*\}/g, "x");
      if (/\s/.test(value)) found.add(value);
    }
  }
  for (const constant of [VESU_REGISTRY_UNAVAILABLE, VESU_UNREGISTERED, VESU_VAULT_DEPOSITS_PAUSED]) {
    found.add(constant);
  }
  return found;
};

// Shown as written, by decision. Each is already a sentence a reader can act
// on, or is unreachable by anything a reader does (marked "unreachable").
const READER_SENTENCES = new Set([
  "Amount must be greater than zero.",
  "Bundled Punk contract artifact is malformed.", // unreachable: build integrity
  "Choose a Punk id between 0 and 9999.",
  "Choose two different assets.",
  "Collection and recipient must be valid Starknet addresses.",
  "Collection name must be between 1 and 48 characters.",
  "Collection, sender, and recipient must be valid Starknet addresses.",
  "Connect Bramble to use private balances.",
  "Connect a wallet before submitting a transaction.",
  "Connect a wallet that supports contract declarations.",
  "Connect a wallet that supports token tracking.",
  "Ekubo sell amount must be greater than zero",
  "Ekubo swap tokens must differ",
  "Enter a valid Multiply margin.",
  "Enter a valid Starknet recipient address.",
  "Enter a valid amount for this position.",
  "Enter a valid amount.",
  "Enter a valid margin amount.",
  "Enter a valid positive amount.",
  "Finish the open wallet request first.",
  "NFT Studio currently supports Starknet Mainnet and Sepolia.",
  "No Ekubo pool for this pair",
  "No Starknet wallet detected. Install the Bramble extension.",
  "No claimable Vesu rewards",
  "Owner and deployment salt must be valid non-zero Starknet felts.",
  "Private swap service is unavailable.",
  "Punk id must be between 0 and 9999.",
  "Request timed out",
  "Root container #root not found", // unreachable: boot invariant
  "Switch the connected wallet to Starknet Mainnet before minting.",
  "Symbol must be 2–10 uppercase letters or numbers.",
  "This Multiply position is missing its debt leg.",
  "This token supports at most x decimal places.",
  "Vesu amount must be greater than zero",
  "Vesu lending is temporarily unavailable",
  VESU_VAULT_DEPOSITS_PAUSED,
  "Wallet did not add the token.",
  "Wallet does not support the request API.",
  "useWallet must be used within a <WalletProvider>", // unreachable: developer invariant
]);

// The diagnostics issue 652 named, plus their siblings. Pinned so a family
// pattern cannot silently stop matching them.
const NAMED_PLUMBING = [
  "Could not quote Vesu wind route",
  "Could not quote Vesu unwind route",
  "Invalid AVNU build response",
  "Invalid Ekubo quote response",
  "Empty Ekubo unwind route",
  "Ekubo returned no Multiply liquidity",
  "AVNU returned no route for this pair",
  "Vesu pool request failed",
  "Vesu vault amount must be a positive u256",
  "No RPC endpoints configured",
  "Wallet did not authorize an account.",
  "Could not resolve the connected account.",
  "The terminal refused an empty wallet request.",
  "Ekubo buildSwapCalls needs an Ekubo route",
];

// Security and cryptographic facts. Each must reach the reader with its fact.
const NAMED_FACTS = [
  "Ekubo Multiply route amount mismatch",
  "Ekubo route does not connect the Multiply assets",
  "Invalid Multiply route",
  "Invalid unwind route",
  "Invalid Vesu reward proof",
  "Invalid AVNU route calldata",
  "AVNU build changed the quoted output",
  "AVNU build charged an unrequested fee",
  "AVNU build returned an unexpected exchange address",
  "AVNU quote changed the requested swap",
  "Private swap service returned a substituted route.",
  "Private swap service returned unexpected executor calls.",
  "Privacy pool returned unsafe configuration.",
  "Wallet returned an invalid transaction hash.",
  "Wallet returned an invalid private proof.",
  "Bundled Punk contract artifact does not match its pinned class hash.",
  "The Vesu API named a vToken this pool does not register",
  VESU_UNREGISTERED,
  VESU_REGISTRY_UNAVAILABLE,
];

describe("terminal error copy conformance", () => {
  const thrown = thrownMessages();

  it("finds the strings it is meant to guard", () => {
    expect(thrown.size).toBeGreaterThan(100);
    expect(thrown.has("Could not quote Vesu wind route")).toBe(true);
    expect(thrown.has("Ekubo Multiply route amount mismatch")).toBe(true);
  });

  it("never shows terminal plumbing as written", () => {
    for (const message of NAMED_PLUMBING) {
      expect(thrown.has(message), message).toBe(true);
      expect(userErrorMessage(new WalletError(message), FALLBACK), message).toBe(FALLBACK);
    }
    const leaked = [...thrown].filter(
      (message) =>
        isInternalMessage(message) &&
        userErrorMessage(new WalletError(message), FALLBACK) === message,
    );
    expect(leaked).toEqual([]);
  });

  it("always shows a security or cryptographic fact", () => {
    for (const message of NAMED_FACTS) {
      expect(thrown.has(message), message).toBe(true);
      expect(isFactMessage(message), message).toBe(true);
      expect(userErrorMessage(new WalletError(message), FALLBACK), message).toBe(message);
    }
    const hidden = [...thrown].filter(
      (message) =>
        isFactMessage(message) && userErrorMessage(new WalletError(message), FALLBACK) !== message,
    );
    expect(hidden).toEqual([]);
  });

  it("classifies every thrown message", () => {
    const unclassified = [...thrown].filter(
      (message) =>
        !isFactMessage(message) && !isInternalMessage(message) && !READER_SENTENCES.has(message),
    );
    expect(unclassified.sort()).toEqual([]);
  });

  it("keeps the swap-intent refusals the shared route check returns", () => {
    // Lowercase facts from packages/foundation/wallet-model/src/swap/avnu-route.ts.
    for (const message of [
      "swap build routed a token you are not selling",
      "swap build routed the proceeds to another account",
      "swap build accepted less than the minimum you reviewed",
      "swap build charged an aggregator fee beyond the wallet's cap",
    ]) {
      expect(userErrorMessage(new WalletError(message), FALLBACK)).toBe(message);
    }
  });
});

describe("userErrorMessage", () => {
  it("keeps the reviewed price-anchor refusals", () => {
    const error = new VesuMultiplyAnchorError("price_premium_exceeded");
    expect(userErrorMessage(error, FALLBACK)).toBe(error.message);
  });

  it("passes a wallet's own error through unchanged", () => {
    expect(userErrorMessage(new Error("Ledger device: Locked device (0x5515)"), FALLBACK)).toBe(
      "Ledger device: Locked device (0x5515)",
    );
    expect(userErrorMessage(new Error("Execution reverted: u256_sub Overflow"), FALLBACK)).toBe(
      "Execution reverted: u256_sub Overflow",
    );
  });

  it("collapses transport detail that would show a URL or a response body", () => {
    expect(userErrorMessage(new HttpError(502, "https://api.example/x", "<html>"), FALLBACK)).toBe(
      FALLBACK,
    );
    expect(userErrorMessage(new ResponseTooLargeError("https://api.example/x", 10), FALLBACK)).toBe(
      FALLBACK,
    );
    const upstream = new Error("Market not found");
    upstream.name = "ExtendedApiError";
    expect(userErrorMessage(upstream, FALLBACK)).toBe(FALLBACK);
  });

  it("uses the fallback for a non-Error or an empty message", () => {
    expect(userErrorMessage("boom", FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage(new Error("  "), FALLBACK)).toBe(FALLBACK);
  });
});
