import { describe, expect, test } from "vitest";
import { buildTokenMetadata, type MetadataDraft } from "./token-metadata";

const draft: MetadataDraft = {
  description: "First garden.\nPlanted on Sepolia.",
  image: "ipfs://bafyimage/1.png",
  name: "Garden #1",
  tokenId: "1",
  traits: [
    { trait: "Background", value: "Moss" },
    { trait: "", value: "" },
    { trait: "Rarity", value: "Rare" },
  ],
};

describe("buildTokenMetadata", () => {
  test("writes the ERC-721/1155 metadata JSON in a fixed field order", () => {
    const metadata = buildTokenMetadata(draft);
    expect(metadata.tokenId).toBe(1n);
    expect(metadata.json).toBe(
      `${JSON.stringify(
        {
          name: "Garden #1",
          description: "First garden.\nPlanted on Sepolia.",
          image: "ipfs://bafyimage/1.png",
          attributes: [
            { trait_type: "Background", value: "Moss" },
            { trait_type: "Rarity", value: "Rare" },
          ],
        },
        null,
        2,
      )}\n`,
    );
    expect(JSON.parse(metadata.json)).toEqual(metadata.document);
  });

  test("leaves out an empty description and traits", () => {
    const metadata = buildTokenMetadata({ ...draft, description: "  ", traits: [{ trait: "", value: "" }] });
    expect(Object.keys(metadata.document)).toEqual(["name", "image"]);
  });

  test("escapes text so the file is always valid JSON", () => {
    const metadata = buildTokenMetadata({ ...draft, name: 'Quote " and \\ slash', traits: [] });
    expect(JSON.parse(metadata.json).name).toBe('Quote " and \\ slash');
  });

  test("refuses each invalid field with a sentence", () => {
    const cases: readonly [Partial<MetadataDraft>, string][] = [
      [{ tokenId: "" }, "Token id must be a whole number."],
      [{ tokenId: "1, 2" }, "Token id must be a whole number."],
      [{ tokenId: "-1" }, "Token id must be a whole number."],
      [{ tokenId: (1n << 256n).toString() }, "Token id must fit in a u256."],
      [{ name: " " }, "Enter a token name."],
      [{ name: "a".repeat(129) }, "Token name must be up to 128 characters."],
      [{ name: "two\nlines" }, "Token name can't contain control characters."],
      [{ description: "d".repeat(1025) }, "Description must be up to 1024 characters."],
      [{ description: "bell\u0007" }, "Description can't contain control characters."],
      [{ image: "" }, "Image URI must be a public https:// or ipfs:// address, with no spaces."],
      [{ image: "https://localhost/1.png" }, "Image URI must be a public https:// or ipfs:// address"],
      [{ image: "data:image/png;base64,AAAA" }, "Image URI must be a public"],
      [{ traits: [{ trait: "Background", value: "" }] }, "Each trait needs a name and a value."],
      [{ traits: [{ trait: "", value: "Moss" }] }, "Each trait needs a name and a value."],
      [{ traits: [{ trait: "t".repeat(129), value: "v" }] }, "Trait must be up to 128 characters."],
      [{ traits: [{ trait: "t", value: "v".repeat(257) }] }, "Value must be up to 256 characters."],
      [
        { traits: Array.from({ length: 33 }, (_, index) => ({ trait: `t${index}`, value: "v" })) },
        "Add up to 32 traits.",
      ],
    ];
    for (const [change, message] of cases) {
      expect(() => buildTokenMetadata({ ...draft, ...change }), message).toThrow(message);
    }
  });

  test("accepts the limits themselves", () => {
    const metadata = buildTokenMetadata({
      ...draft,
      description: "d".repeat(1024),
      name: "n".repeat(128),
      tokenId: ((1n << 256n) - 1n).toString(),
      traits: Array.from({ length: 32 }, (_, index) => ({
        trait: "t".repeat(128),
        value: `${index}`.padEnd(256, "v"),
      })),
    });
    expect(metadata.document.attributes).toHaveLength(32);
  });
});
