/**
 * The file-standards secret-material rule must recognise the session
 * credential accessors and the vault decrypt by name, not only the fields they
 * return. Otherwise `const v = await deps.wallet.readVault(...)` or
 * `session.peekPassphrase()` in a module outside the approved boundary list
 * passes the gate as long as the local is renamed (audit #163: the trust-set
 * vault read must stay inside the secret boundary modules).
 */
import { describe, expect, test } from "bun:test";
import { SECRET_MATERIAL_PATTERN } from "../../scripts/file-standards-policy";

describe("secret-material pattern", () => {
  test("flags the credential accessors and the vault decrypt", () => {
    for (const source of [
      "const credential = session.getPassphrase();",
      "const credential = session.peekPassphrase();",
      "const v = await deps.wallet.readVault(credential);",
    ]) {
      expect(SECRET_MATERIAL_PATTERN.test(source)).toBe(true);
    }
  });

  test("still flags the secret fields themselves", () => {
    expect(SECRET_MATERIAL_PATTERN.test("input.privateKey")).toBe(true);
    expect(SECRET_MATERIAL_PATTERN.test("const { mnemonic } = body;")).toBe(true);
  });

  test("does not flag unrelated identifiers that merely contain a keyword", () => {
    for (const source of ["readVaultStatus()", "seedling", "privateKeyless", "signatureless"]) {
      expect(SECRET_MATERIAL_PATTERN.test(source)).toBe(false);
    }
  });
});
