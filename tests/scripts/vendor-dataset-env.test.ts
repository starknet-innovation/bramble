/**
 * The vendor-dataset scripts read one named value from a git-ignored file
 * (tools/vendor-dataset/dataset-env.ts, sepolia-seeds.ts). Sentinel values
 * only: this points the reader at a temporary file and never opens the real
 * one or touches a network.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envLines, envSeed } from "../../tools/vendor-dataset/dataset-env";
import { sepoliaSecret, sepoliaVar } from "../../tools/vendor-dataset/sepolia-seeds";

const dir = mkdtempSync(join(tmpdir(), "bramble-dataset-env-"));
const file = join(dir, "values.env");
writeFileSync(
  file,
  [
    "# comment line",
    'BRAMBLE_DATASET_SEED_S_BRM="sentinel alpha bravo"',
    "BRAMBLE_DATASET_KEY_K_OZ=0x0abc  ",
    "BRAMBLE_DATASET_SEED_S_SCR=",
    "",
  ].join("\n"),
);

afterAll(() => rmSync(dir, { force: true, recursive: true }));

describe("vendor-dataset value file", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env["BRAMBLE_DATASET_ENV_FILE"];
    process.env["BRAMBLE_DATASET_ENV_FILE"] = file;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env["BRAMBLE_DATASET_ENV_FILE"];
    else process.env["BRAMBLE_DATASET_ENV_FILE"] = previous;
  });

  test("reads the file named by BRAMBLE_DATASET_ENV_FILE", () => {
    expect(envLines()).toHaveLength(5);
  });

  test("returns one named value, unquoted and trimmed", () => {
    expect(envSeed("BRAMBLE_DATASET_SEED_S_BRM")).toBe("sentinel alpha bravo");
    expect(envSeed("BRAMBLE_DATASET_KEY_K_OZ")).toBe("0x0abc");
  });

  test("refuses an absent or empty value without echoing the file", () => {
    expect(() => envSeed("BRAMBLE_DATASET_SEED_S_SCR")).toThrow(
      "BRAMBLE_DATASET_SEED_S_SCR is empty",
    );
    expect(() => envSeed("BRAMBLE_DATASET_SEED_S_RDY")).toThrow(
      "BRAMBLE_DATASET_SEED_S_RDY is empty",
    );
  });

  test("maps a scope-doc id to its variable and reads only that one", () => {
    expect(sepoliaVar("S-BRM")).toBe("BRAMBLE_DATASET_SEED_S_BRM");
    expect(sepoliaVar("K-P256")).toBe("BRAMBLE_DATASET_KEY_K_P256");
    expect(sepoliaSecret("S-BRM")).toBe("sentinel alpha bravo");
    expect(sepoliaSecret("K-OZ")).toBe("0x0abc");
    expect(() => sepoliaSecret("S-LDG")).toThrow("BRAMBLE_DATASET_SEED_S_LDG is empty");
  });
});
