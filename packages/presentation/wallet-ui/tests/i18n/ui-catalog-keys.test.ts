/**
 * The UI catalog is merged from one file per area by object spread, which
 * would silently let a later area overwrite an earlier one's message. Every
 * key must therefore be defined by exactly one area catalog, and every area
 * catalog must be merged.
 */
import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { uiCatalogs } from "../../src/i18n/messages";

const DIR = join(import.meta.dir, "../../src/i18n/messages");

type AreaCatalog = { readonly en: Readonly<Record<string, string>> };

const areaCatalogs = async (): Promise<readonly [string, AreaCatalog][]> => {
  const files = (await readdir(DIR)).filter((file) => file.endsWith(".ts")).sort();
  return Promise.all(
    files.map(async (file): Promise<[string, AreaCatalog]> => {
      const module = (await import(join(DIR, file))) as Record<string, unknown>;
      const catalogs = Object.values(module).filter(
        (value): value is AreaCatalog =>
          typeof value === "object" && value !== null && "en" in value && "zh-Hans" in value,
      );
      expect(catalogs, file).toHaveLength(1);
      return [file, catalogs[0] as AreaCatalog];
    }),
  );
};

test("no message id is defined by two area catalogs", async () => {
  const owners = new Map<string, string[]>();
  for (const [file, catalog] of await areaCatalogs()) {
    for (const key of Object.keys(catalog.en)) owners.set(key, [...(owners.get(key) ?? []), file]);
  }
  const shared = [...owners]
    .filter(([, files]) => files.length > 1)
    .map(([key, files]) => `${key}: ${files.join(", ")}`);
  expect(shared).toEqual([]);
});

test("every area catalog is merged into the UI catalog", async () => {
  const merged = new Set(Object.keys(uiCatalogs.en));
  for (const [file, catalog] of await areaCatalogs()) {
    const missing = Object.keys(catalog.en).filter((key) => !merged.has(key));
    expect(missing, file).toEqual([]);
  }
});
