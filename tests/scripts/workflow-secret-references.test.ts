/**
 * The shared decoded-string secret scan: every spelling GitHub reads as the
 * `secrets` context is found, wherever it sits; properties and identifiers
 * that merely contain the word are not.
 */
import { describe, expect, test } from "bun:test";
import {
  ANY_SECRET,
  documentStrings,
  expressionBodies,
  secretNames,
  secretReferences,
} from "../../scripts/workflow-secret-references";

const E = "$" + "{{";

describe("workflow secret references", () => {
  test("names each spelling of a secrets context reference", () => {
    const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
      [" secrets.KEY ", ["KEY"]],
      ["SECRETS.key", ["KEY"]],
      [" secrets . key_2 ", ["KEY_2"]],
      ["secrets['KEY']", ["KEY"]],
      ['secrets[ "KEY" ]', ["KEY"]],
      ["secrets[format('{0}', 'KEY')]", [ANY_SECRET]],
      ["secrets[env.NAME]", [ANY_SECRET]],
      ["toJSON(secrets)", [ANY_SECRET]],
      ["toJson( Secrets )", [ANY_SECRET]],
      ["secrets", [ANY_SECRET]],
      ["secrets.A && secrets.B", ["A", "B"]],
      ["'secrets.QUOTED'", ["QUOTED"]],
    ];
    for (const [body, names] of cases) expect(secretNames(body)).toEqual([...names]);
  });

  test("ignores properties and identifiers that contain the word", () => {
    for (const body of [
      "steps.secrets.outcome",
      "steps . secrets.outcome",
      "steps.check-secrets.outcome",
      "mysecrets.x",
      "secrets_x.y",
      "needs.secretsjob.result",
    ]) {
      expect(secretNames(body)).toEqual([]);
    }
  });

  test("reads expression bodies through quoted braces and to the end when unterminated", () => {
    expect(expressionBodies(`a ${E} x }} b ${E}y}}`)).toEqual([" x ", "y"]);
    expect(expressionBodies(`${E} format('}}') && secrets.K }}`)).toEqual([
      " format('}}') && secrets.K ",
    ]);
    expect(expressionBodies(`${E} secrets.K`)).toEqual([" secrets.K"]);
    expect(expressionBodies("no expression")).toEqual([]);
  });

  test("lists every key and string value with its path, skipping other scalars", () => {
    expect(documentStrings({ a: ["x", 1, { b: true }], c: null })).toEqual([
      { path: ["a"], key: true, text: "a" },
      { path: ["a", 0], key: false, text: "x" },
      { path: ["a", 2, "b"], key: true, text: "b" },
      { path: ["c"], key: true, text: "c" },
    ]);
  });

  test("finds references in keys, values and bare if conditions only", () => {
    const document = {
      jobs: {
        a: {
          if: "secrets.IN_IF != ''",
          env: { [`${E} secrets.IN_KEY }}`]: "v", PLAIN: "secrets.NOT_AN_EXPRESSION" },
          steps: [{ run: `echo ${E} secrets.IN_RUN }} ${E} secrets.IN_RUN }}` }],
        },
      },
    };
    expect(
      secretReferences(document).map(({ path, key, secret }) => ({ path, key, secret })),
    ).toEqual([
      { path: ["jobs", "a", "if"], key: false, secret: "IN_IF" },
      { path: ["jobs", "a", "env", `${E} secrets.IN_KEY }}`], key: true, secret: "IN_KEY" },
      { path: ["jobs", "a", "steps", 0, "run"], key: false, secret: "IN_RUN" },
      { path: ["jobs", "a", "steps", 0, "run"], key: false, secret: "IN_RUN" },
    ]);
    const wrapped = secretReferences({ if: `${E} secrets.ONCE != '' }}` });
    expect(wrapped.map(({ secret }) => secret)).toEqual(["ONCE"]);
  });
});
