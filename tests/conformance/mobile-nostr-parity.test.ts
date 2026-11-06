/**
 * The mobile core's Nostr and multisig vectors must stay what the extension computes, and each
 * wallet must open the other's gift wraps. Re-run `bun run mobile:parity` (and, for the Rust-made
 * wrap, `BRAMBLE_WRITE_FIXTURES=1 cargo test --locked --test nostr_multisig_parity` in
 * mobile/core) and commit the result when these fail.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  COSIGNER_NOSTR_INDEX,
  computeNostrMultisigParity,
  GIFT_WRAP_IDENTIFIER,
  giftWrapRejections,
  isExtensionRecord,
  NOSTR_MULTISIG_FIXTURE_PATH,
  openWithExtension,
  RUST_GIFT_WRAP_PATH,
} from "../../scripts/mobile-nostr-multisig-parity";

type GiftWrapFixture = {
  readonly content: string;
  readonly eventJson: string;
  readonly identifier: string;
  readonly recipientNostrIndex: number;
  readonly rejections: readonly { readonly eventJson: string; readonly name: string }[];
};

type Fixture = Awaited<ReturnType<typeof computeNostrMultisigParity>> & {
  readonly giftWrap: GiftWrapFixture;
};

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

describe("mobile Nostr and multisig parity", () => {
  test("the committed vectors are what the extension computes today", async () => {
    const { giftWrap: _wrap, ...deterministic } = await readJson<Fixture>(
      NOSTR_MULTISIG_FIXTURE_PATH,
    );
    expect(deterministic).toEqual(JSON.parse(JSON.stringify(await computeNostrMultisigParity())));
  });

  test("the extension-made gift wrap opens, and its variants never do", async () => {
    const { giftWrap, nostrKeys } = await readJson<Fixture>(NOSTR_MULTISIG_FIXTURE_PATH);
    expect(giftWrap.recipientNostrIndex).toBe(COSIGNER_NOSTR_INDEX);
    expect(await openWithExtension(COSIGNER_NOSTR_INDEX, giftWrap.eventJson)).toEqual({
      content: giftWrap.content,
      identifier: GIFT_WRAP_IDENTIFIER,
      senderPublicKey: nostrKeys[0]?.publicKey ?? "",
    });
    expect(await openWithExtension(0, giftWrap.eventJson)).toBeNull();
    expect(giftWrap.rejections).toEqual(giftWrapRejections(giftWrap.eventJson));
    for (const rejection of giftWrap.rejections) {
      expect(await openWithExtension(COSIGNER_NOSTR_INDEX, rejection.eventJson)).toBeNull();
    }
  });

  test("the extension opens the gift wrap the Rust core made", async () => {
    const wrap = await readJson<{
      readonly content: string;
      readonly eventJson: string;
      readonly recipientNostrIndex: number;
      readonly senderPublicKey: string;
    }>(RUST_GIFT_WRAP_PATH);
    expect(wrap.recipientNostrIndex).toBe(COSIGNER_NOSTR_INDEX);
    expect(await openWithExtension(COSIGNER_NOSTR_INDEX, wrap.eventJson)).toEqual({
      content: wrap.content,
      identifier: GIFT_WRAP_IDENTIFIER,
      senderPublicKey: wrap.senderPublicKey,
    });
  });

  test("records mobile stores after a join pass the extension's registry validator", async () => {
    const { joins } = await readJson<Fixture>(NOSTR_MULTISIG_FIXTURE_PATH);
    expect(joins.length).toBeGreaterThan(1);
    for (const join of joins) {
      expect(isExtensionRecord(join.record)).toBe(true);
    }
    const [full, partial] = joins;
    expect(full?.record.currentConfig?.signerPublicKeys).toHaveLength(
      full?.signerGuids.length ?? -1,
    );
    expect(partial?.record.currentConfig).toBeUndefined();
  });
});
