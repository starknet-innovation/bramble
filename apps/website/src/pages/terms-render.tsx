import type { ReactNode } from "react";

/**
 * A deliberately small Markdown renderer for the Terms document, which uses only
 * headings, bold, paragraphs and a single link. It is element-based and never
 * emits raw HTML, so the site's strict Content-Security-Policy holds, and the
 * Terms stay editable as their own source file rather than hand-transcribed TSX.
 * Every run of source text is preserved; only the Markdown markers are consumed.
 * Kept apart from the page so it can be tested without Vite's `?raw` import.
 */
const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;

const resolveEscapes = (value: string): string => value.replace(/\\([.()[\]\\*_`+-])/g, "$1");

export const renderInline = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let index = 0;
  for (const token of text.split(INLINE)) {
    if (token === "") {
      continue;
    }
    const bold = /^\*\*([^*]+)\*\*$/.exec(token);
    if (bold) {
      nodes.push(<strong key={`b${index++}`}>{resolveEscapes(bold[1] ?? "")}</strong>);
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
    if (link) {
      nodes.push(
        <a href={link[2]} key={`l${index++}`} rel="noreferrer" target="_blank">
          {resolveEscapes(link[1] ?? "")}
        </a>,
      );
      continue;
    }
    nodes.push(resolveEscapes(token));
  }
  return nodes;
};

export const renderMarkdown = (source: string): ReactNode[] =>
  source
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const text = block.trim();
      const subheading = /^##\s+([\s\S]*)$/.exec(text);
      if (subheading) {
        return <h3 key={text}>{renderInline(subheading[1] ?? "")}</h3>;
      }
      const heading = /^#\s+([\s\S]*)$/.exec(text);
      if (heading) {
        return <h2 key={text}>{renderInline(heading[1] ?? "")}</h2>;
      }
      return <p key={text}>{renderInline(text.replace(/\n/g, " "))}</p>;
    });

/**
 * The published body: the page header restates the document title and date, so
 * the Terms' own title and date lines are dropped to avoid showing them twice.
 * Nothing else is removed.
 */
export const termsBody = (source: string): string =>
  source.replace(/^\s*\*\*BRAMBLE TERMS OF USE\*\*\s*/i, "").replace(/^Last updated:[^\n]*\n/i, "");
