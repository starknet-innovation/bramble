/**
 * add-chain param validator false branches: a URL-list field whose entries are
 * non-strings, are not parseable URLs, or use a non-http scheme makes the whole
 * chain descriptor reject. Also covers the internal camelCase re-validator.
 */
import { describe, expect, test } from "bun:test";
import {
  isProviderChain,
  MAX_CHAIN_URLS,
  readProviderChain,
} from "@bramble/wallet-protocol/add-chain";

const base = {
  chain_id: "0x534e5f4b4154414e41",
  chain_name: "Katana",
  id: "katana",
};

describe("readProviderChain rejects malformed URL lists", () => {
  test("accepts a well-formed descriptor as the control", () => {
    expect(readProviderChain({ ...base, rpc_urls: ["https://rpc.katana.example"] })).toEqual({
      chainId: base.chain_id,
      chainName: "Katana",
      id: "katana",
      rpcUrls: ["https://rpc.katana.example"],
    });
  });

  test("rejects an rpc_urls entry that is not a string", () => {
    // isHttpUrl bails at the typeof check for the numeric entry, so the whole
    // list reads as malformed and readProviderChain returns null.
    expect(readProviderChain({ ...base, rpc_urls: [123] })).toBeNull();
  });

  test("rejects an rpc_urls entry that is not a parseable URL", () => {
    // A bare token throws inside `new URL`, exercising the catch branch.
    expect(readProviderChain({ ...base, rpc_urls: ["not a url"] })).toBeNull();
  });

  test("rejects a non-http scheme in a URL list", () => {
    expect(readProviderChain({ ...base, block_explorer_url: ["ftp://mirror.example"] })).toBeNull();
  });

  test("rejects an empty URL list", () => {
    expect(readProviderChain({ ...base, icon_urls: [] })).toBeNull();
  });
});

describe("isProviderChain rejects malformed camelCase URL lists", () => {
  test("accepts a well-formed internal chain", () => {
    expect(
      isProviderChain({
        chainId: base.chain_id,
        chainName: "Katana",
        id: "katana",
        rpcUrls: ["https://rpc.katana.example"],
      }),
    ).toBe(true);
  });

  test("rejects a non-parseable URL in rpcUrls", () => {
    expect(
      isProviderChain({
        chainId: base.chain_id,
        chainName: "Katana",
        id: "katana",
        rpcUrls: ["not a url"],
      }),
    ).toBe(false);
  });
});

// Sherlock audit 153: each list was unbounded, so one approved card could store
// 80 URLs of 2 KB. The bridge and the background must agree on the bound.
describe("add-chain URL lists are bounded on both sides of the wire", () => {
  const urls = (count: number) =>
    Array.from({ length: count }, (_, index) => `https://rpc${index}.example`);
  const internal = (field: string, count: number) => ({
    chainId: base.chain_id,
    chainName: "Katana",
    id: "katana",
    [field]: urls(count),
  });

  for (const [wire, field] of [
    ["rpc_urls", "rpcUrls"],
    ["block_explorer_url", "blockExplorerUrls"],
    ["icon_urls", "iconUrls"],
  ] as const) {
    test(`accepts ${MAX_CHAIN_URLS} ${wire} entries and rejects one more`, () => {
      expect(readProviderChain({ ...base, [wire]: urls(MAX_CHAIN_URLS) })).not.toBeNull();
      expect(readProviderChain({ ...base, [wire]: urls(MAX_CHAIN_URLS + 1) })).toBeNull();
      expect(isProviderChain(internal(field, MAX_CHAIN_URLS))).toBe(true);
      expect(isProviderChain(internal(field, MAX_CHAIN_URLS + 1))).toBe(false);
    });
  }
});
