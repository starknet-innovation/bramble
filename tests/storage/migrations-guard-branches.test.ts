/**
 * migrateVault fail-closed guards not reached by the main migration suite: a
 * value declaring schemaVersion 1 that is not a valid v1 vault is rejected by
 * the v1->v2 step, and a value declaring the current schemaVersion that is not a
 * valid v2 vault is rejected after the (empty) migration loop.
 */
import { describe, expect, test } from "bun:test";
import { CURRENT_SCHEMA_VERSION, migrateVault } from "../../src/storage/migrations";

describe("migrateVault guards", () => {
  test("rejects a schema-v1 tag on a value that is not a valid v1 vault", () => {
    // schemaVersionOf reads 1, so the v1->v2 step runs and its isVaultV1 guard
    // throws rather than fabricating a partial vault.
    expect(() => migrateVault({ schemaVersion: 1 })).toThrow("Unsupported vault schema");
  });

  test("rejects a value tagged with the current schema that is not a valid v2 vault", () => {
    // Not accepted by the fast-path isVaultV2 check, start version equals the
    // current version so the loop makes no step, and the post-loop v2 guard fails.
    expect(() => migrateVault({ schemaVersion: CURRENT_SCHEMA_VERSION })).toThrow(
      "Unsupported vault schema",
    );
  });
});
