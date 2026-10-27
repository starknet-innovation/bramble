/** What a user pastes to find an account by its address (issue 398). */
import { describe, expect, test } from "bun:test";
import {
  networkName,
  readPastedAddress,
} from "../../../../src/sidepanel/journeys/onboarding/recovery-address";

const ADDRESS = "0x7e57ad0e55";

describe("readPastedAddress", () => {
  test("reads an address, in any case and with surrounding space, as a canonical felt", () => {
    expect(readPastedAddress(ADDRESS)).toEqual({ address: ADDRESS });
    expect(readPastedAddress("  0x0007E57AD0E55 \n")).toEqual({ address: ADDRESS });
  });

  test("reads Starkscan and Voyager account links, with the network each serves", () => {
    for (const [link, network] of [
      [`https://starkscan.co/contract/${ADDRESS}`, "SN_MAIN"],
      [`https://starkscan.co/account/${ADDRESS}/`, "SN_MAIN"],
      [`https://sepolia.starkscan.co/contract/${ADDRESS}`, "SN_SEPOLIA"],
      [`https://voyager.online/contract/${ADDRESS}`, "SN_MAIN"],
      [`https://sepolia.voyager.online/contract/${ADDRESS}`, "SN_SEPOLIA"],
      [`https://www.voyager.online/contract/${ADDRESS}`, "SN_MAIN"],
    ] as const) {
      expect(readPastedAddress(link)).toEqual({ address: ADDRESS, network });
    }
  });

  test("refuses anything else", () => {
    for (const text of [
      "",
      "0x0",
      "7e57ad0e55",
      "0xnothex",
      `0x${"f".repeat(70)}`,
      `https://starkscan.example/contract/${ADDRESS}`,
      `https://starkscan.co/tx/${ADDRESS}`,
      `https://starkscan.co/contract/${ADDRESS}/events`,
      "https://",
    ]) {
      expect(readPastedAddress(text)).toEqual({ reason: "invalid" });
    }
  });

  test("an http:// explorer link is named, not read, and only for a known explorer", () => {
    expect(readPastedAddress(`http://starkscan.co/contract/${ADDRESS}`)).toEqual({
      reason: "insecure-link",
    });
    expect(readPastedAddress(`http://sepolia.voyager.online/contract/${ADDRESS}`)).toEqual({
      reason: "insecure-link",
    });
    expect(readPastedAddress(`http://starkscan.example/contract/${ADDRESS}`)).toEqual({
      reason: "invalid",
    });
    expect(readPastedAddress(`ftp://starkscan.co/contract/${ADDRESS}`)).toEqual({
      reason: "invalid",
    });
  });
});

describe("networkName", () => {
  test("names a known network and passes an unknown id through", () => {
    expect(networkName("SN_MAIN")).toBe("Starknet Mainnet");
    expect(networkName("SN_SEPOLIA")).toBe("Starknet Sepolia");
    expect(networkName("SOMETHING")).toBe("SOMETHING");
  });
});
