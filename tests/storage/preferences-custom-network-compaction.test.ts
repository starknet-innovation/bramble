/**
 * Stored custom networks shrink on read (Sherlock audit 153), including in a
 * record that has nothing else to normalize: the early return in
 * normalizeStoredPreferences must not skip them.
 */
import { describe, expect, test } from "bun:test";
import { normalizeStoredPreferences } from "../../packages/features/settings/src/preferences-stored";

const network = {
  blockExplorerUrls: ["https://explorer.example"],
  chainId: "0x534e5f4b4154414e41",
  iconUrls: ["https://icons.example/a.png"],
  id: "katana",
  name: "Katana",
  rpcUrls: ["https://rpc1.example", "https://rpc2.example"],
};

describe("normalizeStoredPreferences custom networks", () => {
  test("strips unread lists even when no other field needs repair", () => {
    expect(normalizeStoredPreferences({ customNetworks: [network], schemaVersion: 1 })).toEqual({
      customNetworks: [
        {
          chainId: network.chainId,
          id: "katana",
          name: "Katana",
          rpcUrls: ["https://rpc1.example"],
        },
      ],
      schemaVersion: 1,
    });
  });

  test("keeps only the newest sixteen networks", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      chainId: `0x${(0x1000 + index).toString(16)}`,
      id: `chain-${index}`,
      name: `Chain ${index}`,
    }));
    const normalized = normalizeStoredPreferences({ customNetworks: many }) as {
      customNetworks: readonly { id: string }[];
    };
    expect(normalized.customNetworks.map((entry) => entry.id)).toEqual(
      many.slice(-16).map((entry) => entry.id),
    );
  });

  test("returns an already compact record unchanged", () => {
    const compact = { customNetworks: [{ chainId: "0x1", id: "one", name: "One" }] };
    expect(normalizeStoredPreferences(compact)).toBe(compact);
  });
});
