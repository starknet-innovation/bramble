/**
 * Saving a known address never swaps the contact's keys (Sherlock 258).
 *
 * The multisig flow trusts a contact's signer key and coordination key. The
 * store already kept a stored key when a save omitted it; a save carrying a
 * different key replaced it silently, so a wallet card for a known co-signer's
 * address could swap their coordination key under the label the user trusts.
 */
import { describe, expect, test } from "bun:test";
import { createPreferencesStore } from "@bramble/settings/preferences";
import { createMemoryStore } from "@bramble/store/kv";
import { contactKeysChange } from "../src/preferences-contacts";

const address = "0x123";
const signerKey = "0xabc";
const nostrKey = "a".repeat(64);
const otherNostrKey = "b".repeat(64);

const withContact = async () => {
  const preferences = createPreferencesStore({ store: createMemoryStore() });
  await preferences.saveAddress({
    address,
    label: "Ada",
    networkId: "SN_MAIN",
    nostrPublicKey: nostrKey,
    publicKeyX: signerKey,
  });
  return preferences;
};

const stored = async (preferences: Awaited<ReturnType<typeof withContact>>) =>
  (await preferences.read()).addressBook[0];

describe("saveAddress key stability", () => {
  test("refuses a different coordination key and keeps the stored one", async () => {
    const preferences = await withContact();
    await expect(
      preferences.saveAddress({
        address,
        label: "Ada",
        networkId: "SN_MAIN",
        nostrPublicKey: otherNostrKey,
        publicKeyX: signerKey,
      }),
    ).rejects.toThrow("Contact keys changed");
    expect((await stored(preferences))?.nostrPublicKey).toBe(nostrKey);
  });

  test("refuses a different signer key and keeps the stored one", async () => {
    const preferences = await withContact();
    await expect(
      preferences.saveAddress({ address, label: "Ada", networkId: "SN_MAIN", publicKeyX: "0xdef" }),
    ).rejects.toThrow("Contact keys changed");
    expect((await stored(preferences))?.publicKeyX).toBe(signerKey);
  });

  test("still relabels, and keeps keys the save omits", async () => {
    const preferences = await withContact();
    await preferences.saveAddress({ address, label: "Ada (work)", networkId: "SN_MAIN" });
    expect(await stored(preferences)).toMatchObject({
      label: "Ada (work)",
      nostrPublicKey: nostrKey,
      publicKeyX: signerKey,
    });
  });

  test("accepts the same keys, however the felt is spelled", async () => {
    const preferences = await withContact();
    await preferences.saveAddress({
      address,
      label: "Ada",
      networkId: "SN_MAIN",
      nostrPublicKey: nostrKey,
      publicKeyX: `0x${"0".repeat(10)}abc`,
    });
    expect((await stored(preferences))?.label).toBe("Ada");
  });

  test("adds a key the contact lacked", async () => {
    const preferences = createPreferencesStore({ store: createMemoryStore() });
    await preferences.saveAddress({ address, label: "Ada", networkId: "SN_MAIN" });
    await preferences.saveAddress({
      address,
      label: "Ada",
      networkId: "SN_MAIN",
      nostrPublicKey: nostrKey,
      publicKeyX: signerKey,
    });
    expect(await stored(preferences)).toMatchObject({
      nostrPublicKey: nostrKey,
      publicKeyX: signerKey,
    });
  });

  test("replaces keys after the contact is removed", async () => {
    const preferences = await withContact();
    const id = (await stored(preferences))?.id ?? "";
    await preferences.removeAddress(id);
    await preferences.saveAddress({
      address,
      label: "Ada",
      networkId: "SN_MAIN",
      nostrPublicKey: otherNostrKey,
    });
    expect((await stored(preferences))?.nostrPublicKey).toBe(otherNostrKey);
  });
});

describe("contactKeysChange", () => {
  test("compares signer keys as felts, not as text", () => {
    expect(contactKeysChange({ publicKeyX: "0xabc" }, { publicKeyX: "0x0abc" })).toBe(false);
    expect(contactKeysChange({ publicKeyX: "0xabc" }, { publicKeyX: "0xabd" })).toBe(true);
  });
});
