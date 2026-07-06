/**
 * Skin checks prove popup colors are provided through replaceable tokens.
 */
import { expect, test } from "bun:test";

import { defaultSkin } from "../src/ui/default-skin";
import { applySkin, type Skin } from "../src/ui/skin";

test("applySkin writes every default token to the target root", () => {
  const applied: Record<string, string> = {};
  const root = {
    style: {
      setProperty(token: string, value: string) {
        applied[token] = value;
      },
    },
  } as unknown as HTMLElement;

  applySkin(defaultSkin, root);

  expect(applied).toEqual(defaultSkin.tokens);
  expect(applied["--mc-accent-text"]).toBe("#ffffff");
});

test("applySkin rejects incomplete replacement skins", () => {
  const root = {
    style: {
      setProperty() {
        throw new Error("invalid skin must not apply");
      },
    },
  } as unknown as HTMLElement;

  expect(() =>
    applySkin(
      {
        name: "missing",
        tokens: { "--mc-accent": "#000000" } as Skin["tokens"],
      },
      root,
    ),
  ).toThrow("Invalid skin token set");
});

test("applySkin rejects extra replacement skin tokens", () => {
  const root = {
    style: {
      setProperty() {
        throw new Error("invalid skin must not apply");
      },
    },
  } as unknown as HTMLElement;
  const hidden = { ...defaultSkin.tokens };
  Object.defineProperty(hidden, "--mc-shadow", { value: "0 0 0 transparent" });
  const symbol = { ...defaultSkin.tokens, [Symbol("debug")]: "true" };

  expect(() =>
    applySkin(
      {
        name: "extra",
        tokens: {
          ...defaultSkin.tokens,
          "--mc-shadow": "0 0 0 transparent",
        } as Skin["tokens"],
      },
      root,
    ),
  ).toThrow("Invalid skin token set");
  expect(() => applySkin({ name: "hidden", tokens: hidden }, root)).toThrow(
    "Invalid skin token set",
  );
  expect(() => applySkin({ name: "symbol", tokens: symbol }, root)).toThrow(
    "Invalid skin token set",
  );
});
