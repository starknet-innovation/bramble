/**
 * Constructor calldata per account class (Sherlock 240).
 *
 * Every class an address can be derived from names a constructor shape, and
 * each shape has exactly one layout. The derivation of every address in the
 * wallet rests on this mapping, so it is pinned per class, and a shape the
 * wallet does not know is refused rather than given another version's layout.
 */
import { expect, test } from "bun:test";
import {
  ACCOUNT_CLASSES,
  type AccountConstructorShape,
  accountConstructorCalldata,
} from "@bramble/wallet-model/account-families";

const KEY = "0xabc";
const LAYOUTS: Readonly<Record<AccountConstructorShape, readonly string[]>> = {
  "owner-guardian": [KEY, "0x0"],
  "public-key": [KEY],
  "signer-owner-guardian-option": ["0x0", KEY, "0x1"],
};

test("every account class gets its shape's layout", () => {
  for (const entry of ACCOUNT_CLASSES) {
    expect(accountConstructorCalldata(entry.constructorShape, KEY)).toEqual(
      LAYOUTS[entry.constructorShape],
    );
  }
});

test("every shape in use has a pinned layout", () => {
  const shapes = new Set(ACCOUNT_CLASSES.map((entry) => entry.constructorShape));
  expect([...shapes].sort() as readonly string[]).toEqual(Object.keys(LAYOUTS).sort());
});

test("a shape the wallet does not know is refused, not given another layout", () => {
  expect(() =>
    accountConstructorCalldata("signer-owner-guardian-v2" as AccountConstructorShape, KEY),
  ).toThrow("unknown account constructor shape");
});
