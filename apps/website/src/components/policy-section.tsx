import type { ReactNode } from "react";
import { type PrivacySectionId, privacySection } from "../content/privacy-sections";

type PolicySectionProps = {
  readonly id: PrivacySectionId;
  readonly children: ReactNode;
};

/**
 * Renders one numbered policy section under the heading registered for its id.
 *
 * Taking the number and heading from the registry rather than from the call
 * site is what keeps the on-page index, the anchor, and the printed heading in
 * agreement; an unregistered id throws instead of rendering an unlabelled
 * block.
 */
export const PolicySection = ({ id, children }: PolicySectionProps) => {
  const section = privacySection(id);
  return (
    <section id={id}>
      <h2>{`${section.number}. ${section.heading}`}</h2>
      {children}
    </section>
  );
};

type PolicyTableProps = {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

/**
 * Renders one of the policy's reference tables.
 *
 * Cells carry their column name in `data-label` so the narrow-screen stylesheet
 * can restack the table as labelled rows rather than leave a four-column legal
 * table to scroll sideways; the markup stays a real table, so assistive
 * technology keeps the header associations either way. A newline in a cell is a
 * line break in the source document, not a paragraph.
 */
export const PolicyTable = ({ caption, headers, rows }: PolicyTableProps) => (
  <div className="policy-table-scroll">
    <table className="policy-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.join("|")}>
            {row.map((cell, index) => (
              <td data-label={headers[index]} key={headers[index] ?? index}>
                {cell.split("\n").map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
