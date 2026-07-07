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
  expect(applied["--mc-accent-text"]).toBe(defaultSkin.tokens["--mc-accent-text"]);
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

test("applySkin rejects malformed replacement skin containers", () => {
  const root = {
    style: {
      setProperty() {
        throw new Error("invalid skin must not apply");
      },
    },
  } as unknown as HTMLElement;

  expect(() => applySkin(null as unknown as Skin, root)).toThrow("Invalid skin token set");
  expect(() => applySkin({ name: "missing" } as Skin, root)).toThrow("Invalid skin token set");
  expect(() => applySkin({ name: "", tokens: defaultSkin.tokens }, root)).toThrow(
    "Invalid skin token set",
  );
  expect(() => applySkin({ name: "array", tokens: [] } as unknown as Skin, root)).toThrow(
    "Invalid skin token set",
  );
  expect(() =>
    applySkin({ name: "extra", tokens: defaultSkin.tokens, version: 1 } as unknown as Skin, root),
  ).toThrow("Invalid skin token set");
  expect(() => applySkin(Object.create({ tokens: defaultSkin.tokens }) as Skin, root)).toThrow(
    "Invalid skin token set",
  );
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

test("applySkin rejects non-data replacement skin tokens", () => {
  const root = {
    style: {
      setProperty() {
        throw new Error("invalid skin must not apply");
      },
    },
  } as unknown as HTMLElement;
  const hiddenKnown = { ...defaultSkin.tokens };
  Object.defineProperty(hiddenKnown, "--mc-accent", {
    enumerable: false,
    value: "#000000",
  });
  const accessorKnown = { ...defaultSkin.tokens };
  Object.defineProperty(accessorKnown, "--mc-accent", {
    enumerable: true,
    get() {
      return "#000000";
    },
  });
  const accessorName = { tokens: defaultSkin.tokens };
  Object.defineProperty(accessorName, "name", {
    enumerable: true,
    get() {
      return "accessor";
    },
  });

  expect(() => applySkin({ name: "hidden-known", tokens: hiddenKnown }, root)).toThrow(
    "Invalid skin token set",
  );
  expect(() => applySkin({ name: "accessor-known", tokens: accessorKnown }, root)).toThrow(
    "Invalid skin token set",
  );
  expect(() => applySkin(accessorName as unknown as Skin, root)).toThrow("Invalid skin token set");
});
