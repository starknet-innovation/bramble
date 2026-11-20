/**
 * The extension's store-listing locales (`_locales/`): Chrome and AMO read the
 * manifest description from them, so every shipped locale must define every
 * message the manifest references, within Chrome's length limit.
 */
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LOCALES } from "@bramble/core/i18n";

const PUBLIC = join(import.meta.dir, "../../apps/extension/public");
// Chrome's limit on the manifest description, applied to every locale's text.
const DESCRIPTION_LIMIT = 132;
// Store locale folder for each shipped UI locale (Chrome's underscore names).
const STORE_LOCALE: Readonly<Record<(typeof LOCALES)[number], string>> = {
  en: "en",
  "zh-Hans": "zh_CN",
};

type Messages = Record<string, { readonly message: string; readonly description?: string }>;

const manifest = async (): Promise<Record<string, unknown>> =>
  (await Bun.file(join(PUBLIC, "manifest.json")).json()) as Record<string, unknown>;
const messages = async (folder: string): Promise<Messages> =>
  (await Bun.file(join(PUBLIC, "_locales", folder, "messages.json")).json()) as Messages;

describe("extension store locales", () => {
  test("English is the default and the description comes from the catalog", async () => {
    const chrome = await manifest();
    expect(chrome["default_locale"]).toBe("en");
    expect(chrome["description"]).toBe("__MSG_extensionDescription__");
  });

  test("ships exactly one store locale per UI locale", async () => {
    const folders = (await readdir(join(PUBLIC, "_locales"))).sort();
    expect(folders).toEqual(Object.values(STORE_LOCALE).sort());
  });

  test("every locale defines every message the manifest references", async () => {
    const referenced = [...JSON.stringify(await manifest()).matchAll(/__MSG_(\w+)__/gu)].map(
      (match) => match[1] ?? "",
    );
    const english = await messages("en");
    expect(Object.keys(english).sort()).toEqual([...new Set(referenced)].sort());
    for (const folder of Object.values(STORE_LOCALE)) {
      expect(Object.keys(await messages(folder)).sort(), folder).toEqual(
        Object.keys(english).sort(),
      );
    }
  });

  test("each description fits Chrome's limit and carries no markup", async () => {
    for (const folder of Object.values(STORE_LOCALE)) {
      const text = (await messages(folder))["extensionDescription"]?.message ?? "";
      expect(text.length, folder).toBeGreaterThan(0);
      expect(text.length, folder).toBeLessThanOrEqual(DESCRIPTION_LIMIT);
      expect(text, folder).not.toMatch(/[<>]/u);
    }
  });

  test("the name stays literal in every store", async () => {
    expect(await manifest()).toMatchObject({ name: "Bramble: Starknet Wallet" });
  });
});
