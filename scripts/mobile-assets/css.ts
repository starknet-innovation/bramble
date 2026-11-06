/**
 * A small, strict reader for the side panel's rendered stylesheet (`SIDEPANEL_STYLES`). The mobile
 * generators read elevation tiers, press scales, and layout metrics from the CSS the extension
 * actually ships, rather than restating them. The reader only understands the flat shape the
 * stylesheet uses (style rules, optionally inside one or more `@media` blocks); anything else is
 * skipped, and the callers throw when a value they ask for is missing.
 */

/**
 * One style rule: its selector list, the `@media` conditions (or `@keyframes <name>`) around it,
 * and its declarations.
 */
export type CssRule = {
  readonly selectors: readonly string[];
  readonly media: readonly string[];
  readonly declarations: readonly (readonly [string, string])[];
};

const normalise = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Splits a selector list on top-level commas (commas inside `:is()`/`:where()` stay). */
const splitSelectors = (list: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(normalise(current));
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(normalise(current));
  return parts.filter((part) => part.length > 0);
};

const parseDeclarations = (body: string): [string, string][] =>
  body
    .split(";")
    .map((part) => {
      const colon = part.indexOf(":");
      return colon < 0
        ? null
        : ([normalise(part.slice(0, colon)), normalise(part.slice(colon + 1))] as [string, string]);
    })
    .filter((entry): entry is [string, string] => entry !== null && entry[0].length > 0);

/**
 * Every style rule in source order. Comments are dropped. Keyframe steps (`50%`) are recorded
 * with the condition `@keyframes <name>`; other at-rules are skipped.
 */
export const parseCss = (source: string): readonly CssRule[] => {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  const stack: { readonly prelude: string; readonly kind: "media" | "skip" | "rule" }[] = [];
  let buffer = "";
  for (const char of css) {
    if (char === "{") {
      const prelude = normalise(buffer);
      buffer = "";
      const skipping = stack.some((frame) => frame.kind === "skip");
      if (prelude.startsWith("@media")) {
        stack.push({ kind: skipping ? "skip" : "media", prelude: prelude.slice(6).trim() });
      } else if (prelude.startsWith("@keyframes")) {
        // Keyframe steps are recorded under the condition "@keyframes <name>".
        stack.push({ kind: skipping ? "skip" : "media", prelude });
      } else if (prelude.startsWith("@")) {
        stack.push({ kind: "skip", prelude });
      } else {
        stack.push({ kind: skipping ? "skip" : "rule", prelude });
      }
    } else if (char === "}") {
      const frame = stack.pop();
      if (frame?.kind === "rule") {
        rules.push({
          declarations: parseDeclarations(buffer),
          media: stack.filter((f) => f.kind === "media").map((f) => f.prelude),
          selectors: splitSelectors(frame.prelude),
        });
      }
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return rules;
};

/** Custom properties declared on `:root` outside any media query, last declaration winning. */
export const rootProperties = (rules: readonly CssRule[]): ReadonlyMap<string, string> => {
  const properties = new Map<string, string>();
  for (const rule of rules) {
    if (rule.media.length === 0 && rule.selectors.includes(":root")) {
      for (const [name, value] of rule.declarations) {
        if (name.startsWith("--")) properties.set(name, value);
      }
    }
  }
  return properties;
};

/** Replaces `var(--x)` references with their `:root` values, recursively. Throws on a cycle. */
export const resolveVars = (
  value: string,
  root: ReadonlyMap<string, string>,
  depth = 0,
): string => {
  if (depth > 8) {
    throw new Error(`Custom property cycle while resolving ${value}`);
  }
  const resolved = value.replace(/var\((--[a-z0-9-]+)\)/g, (whole, name: string) => {
    const next = root.get(name);
    if (next === undefined) {
      throw new Error(`Unresolved custom property ${name} in ${whole}`);
    }
    return next;
  });
  return resolved === value ? value : resolveVars(resolved, root, depth + 1);
};

/**
 * The last value of `property` on a rule whose selector list contains exactly `selector`, inside
 * exactly the given media conditions (none by default). Equal selectors share a specificity, so
 * source order decides, as it does in the browser.
 */
export const declaredValue = (
  rules: readonly CssRule[],
  selector: string,
  property: string,
  media: readonly string[] = [],
): string | undefined => {
  let found: string | undefined;
  for (const rule of rules) {
    if (
      rule.selectors.includes(selector) &&
      rule.media.length === media.length &&
      rule.media.every((condition, index) => condition === media[index])
    ) {
      for (const [name, value] of rule.declarations) {
        if (name === property) found = value;
      }
    }
  }
  return found;
};

/**
 * Evaluates a px length, or a `calc()` over px terms with `+`, `*` and parentheses (nested
 * `calc()` included, as `var()` substitution produces). Anything else throws.
 */
export const evaluatePx = (value: string): number => {
  const plain = /^(-?\d+(?:\.\d+)?)px$/.exec(value);
  if (plain?.[1]) return Number(plain[1]);
  if (value === "0") return 0;
  if (!value.startsWith("calc(")) {
    throw new Error(`Expected a px length or calc(), got ${value}`);
  }
  const tokens = value
    .replace(/calc\(/g, "(")
    .replace(/(\d+(?:\.\d+)?)px/g, " $1 ")
    .replace(/([()+*])/g, " $1 ")
    .trim()
    .split(/\s+/);
  let at = 0;
  const fail = (): never => {
    throw new Error(`Unsupported calc() ${value}`);
  };
  const factor = (): number => {
    const token = tokens[at++];
    if (token === "(") {
      const inner = sum();
      if (tokens[at++] !== ")") fail();
      return inner;
    }
    const number = Number(token);
    return token === undefined || Number.isNaN(number) ? fail() : number;
  };
  const product = (): number => {
    let result = factor();
    while (tokens[at] === "*") {
      at += 1;
      result *= factor();
    }
    return result;
  };
  const sum = (): number => {
    let result = product();
    while (tokens[at] === "+") {
      at += 1;
      result += product();
    }
    return result;
  };
  const result = sum();
  return at === tokens.length ? result : fail();
};
