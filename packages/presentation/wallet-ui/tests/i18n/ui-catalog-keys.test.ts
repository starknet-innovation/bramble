/**
 * The UI catalog is merged from one file per area by object spread, which
 * would silently let a later area overwrite an earlier one's message. Every
 * key must therefore be defined by exactly one area catalog, and every area
 * catalog file must be listed in `UI_AREA_CATALOGS` (and so merged).
 */
import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { UI_AREA_CATALOGS, uiCatalogs } from "../../src/i18n/messages";

const DIR = join(import.meta.dir, "../../src/i18n/messages");

test("every area catalog file is listed and merged", async () => {
  const files = (await readdir(DIR))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.slice(0, -3))
    .sort();
  expect(Object.keys(UI_AREA_CATALOGS).sort()).toEqual(files);
  const merged = new Set(Object.keys(uiCatalogs.en));
  for (const [area, catalog] of Object.entries(UI_AREA_CATALOGS)) {
    expect(
      Object.keys(catalog.en).filter((key) => !merged.has(key)),
      area,
    ).toEqual([]);
  }
});

test("no message id is defined by two area catalogs", () => {
  const owners = new Map<string, string[]>();
  for (const [area, catalog] of Object.entries(UI_AREA_CATALOGS)) {
    for (const key of Object.keys(catalog.en)) owners.set(key, [...(owners.get(key) ?? []), area]);
  }
  const shared = [...owners]
    .filter(([, areas]) => areas.length > 1)
    .map(([key, areas]) => `${key}: ${areas.join(", ")}`);
  expect(shared).toEqual([]);
});
