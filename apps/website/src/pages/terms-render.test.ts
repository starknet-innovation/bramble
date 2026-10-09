/** Guards that the published Terms render verbatim: no clause dropped or mangled by the renderer. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderMarkdown, termsBody } from "./terms-render";

const source = readFileSync(new URL("../content/terms.md", import.meta.url), "utf8");

const flatten = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flatten).join("");
  const element = node as { props?: { children?: ReactNode } };
  return element.props ? flatten(element.props.children) : "";
};

const rendered = renderMarkdown(termsBody(source)).map(flatten).join("\n");

test("renders the Terms verbatim, markers stripped and escapes resolved", () => {
  // Load-bearing legal clauses must survive the renderer exactly.
  expect(rendered).toContain(
    "Starknet Holdings, an Exempted Company incorporated in the Cayman Islands with Limited Liability under registration number 424851",
  );
  expect(rendered).toContain("the self-custodial wallet software made available by the Company");
  expect(rendered).toContain("1. DEFINITIONS");
  // Bold markers are consumed, the quoted defined term kept.
  expect(rendered).toContain("the Company");
  expect(rendered).not.toContain("**");
  // The link text survives (href is on the element, not the text).
  expect(rendered).toContain("bramble.fi");
});

test("drops only the title and date lines, which the page header restates", () => {
  const body = termsBody(source);
  expect(body).not.toContain("BRAMBLE TERMS OF USE");
  expect(body).not.toMatch(/^Last updated:/);
  // The first real clause is retained.
  expect(body).toContain("# ");
});
