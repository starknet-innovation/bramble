/**
 * Account birds: the address-to-traits mapping is pinned, because people learn
 * their bird and a silent change redraws every account; the markup draws only
 * from identity tokens; and a realistic population of addresses stays distinct.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { accountAvatar, accountBirdTraits } from "../../../src/sidepanel/shell/account-avatar";

// Uniformly distributed 251-bit addresses, as deployed account addresses are.
const sampleAddress = (index: number): string => {
  const digest = createHash("sha256").update(`bramble-bird-${index}`).digest("hex");
  return `0x0${digest.slice(1)}`;
};

describe("accountBirdTraits", () => {
  // Changing any of these is a deliberate redraw of every account's bird.
  test.each([
    [
      "0x0",
      {
        accent: 0,
        beak: 0,
        body: 0,
        crest: 0,
        eye: 0,
        ground: 0,
        mirrored: false,
        shape: 0,
        tail: 0,
      },
    ],
    [
      "0x1234",
      {
        accent: 1,
        beak: 0,
        body: 0,
        crest: 2,
        eye: 0,
        ground: 0,
        mirrored: false,
        shape: 1,
        tail: 1,
      },
    ],
    [
      "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
      {
        accent: 2,
        beak: 0,
        body: 1,
        crest: 1,
        eye: 0,
        ground: 1,
        mirrored: true,
        shape: 1,
        tail: 2,
      },
    ],
  ])("pins the bird drawn for %s", (address, traits) => {
    expect(accountBirdTraits(address)).toEqual(traits);
  });

  test("reads the same bird from every canonical spelling", () => {
    expect(accountBirdTraits("0x001234")).toEqual(accountBirdTraits("0x1234"));
    expect(accountBirdTraits("0X1234")).toEqual(accountBirdTraits("0x1234"));
  });

  test("maps malformed and negative input to the zero-address bird", () => {
    const zero = accountBirdTraits("0x0");
    expect(accountBirdTraits("not-hex<script>")).toEqual(zero);
    expect(accountBirdTraits("-1")).toEqual(zero);
    expect(accountBirdTraits("")).toEqual(zero);
  });
});

describe("accountAvatar", () => {
  test("keeps 500 sample addresses almost entirely distinct", () => {
    // About 78,000 combinations; 500 draws expect under two collisions.
    const birds = new Set(
      Array.from({ length: 500 }, (_, index) => accountAvatar(sampleAddress(index))),
    );
    expect(birds.size).toBeGreaterThanOrEqual(495);
  });

  test("reaches every ground, body, and accent tone", () => {
    const traits = Array.from({ length: 200 }, (_, index) =>
      accountBirdTraits(sampleAddress(index)),
    );
    expect(new Set(traits.map((bird) => bird.ground)).size).toBe(4);
    expect(new Set(traits.map((bird) => bird.body)).size).toBe(5);
    expect(new Set(traits.map((bird) => bird.accent)).size).toBe(4);
  });

  test("draws only from identity tokens, with no raw colour or remote imagery", () => {
    for (let index = 0; index < 50; index += 1) {
      const bird = accountAvatar(sampleAddress(index));
      const colours = [...bird.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((match) => match[1]);
      for (const colour of colours) {
        expect(colour).toMatch(/^(?:none|var\(--bramble-account-avatar-[a-z]+(?:-\d)?\))$/);
      }
      expect(bird).not.toContain("href");
      expect(bird).not.toContain("<image");
    }
  });

  test("mirrors a left-facing bird and leaves a right-facing one unflipped", () => {
    const left = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
    expect(accountAvatar(left)).toContain("scale(-1 1)");
    expect(accountAvatar("0x1234")).not.toContain("scale(-1 1)");
  });

  test("never reflects malformed input into markup", () => {
    const fallback = accountAvatar("not-hex<script>");
    expect(fallback).toBe(accountAvatar("0x0"));
    expect(fallback).not.toContain("script");
  });
});
