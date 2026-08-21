/** Formula-safe CSV export for persisted wallet activity. */

type ActivityCsvEntry = {
  readonly accountId: string;
  readonly amount?: string;
  readonly counterparty?: string;
  readonly hash: string;
  readonly kind: string;
  readonly networkId: string;
  readonly status: string;
  readonly submittedAt: number;
  readonly summary: string;
  readonly token?: string;
};

const CSV_HEADER =
  "datetime,networkId,accountId,kind,status,amount,token,counterparty,hash,summary";
const CSV_FORMULA_LEAD = /^[\t\r=+@-]/;
const isPaddingCode = (code: number): boolean => code <= 0x20 || code === 0x7f;

const withoutLeadPadding = (value: string): string => {
  let current = value.trimStart();
  while (current.length > 0 && isPaddingCode(current.charCodeAt(0))) {
    current = current.slice(1).trimStart();
  }
  return current;
};

const opensFormula = (value: string): boolean =>
  CSV_FORMULA_LEAD.test(value) || CSV_FORMULA_LEAD.test(withoutLeadPadding(value));

const csvField = (value: string): string => {
  const literal = opensFormula(value) ? `'${value}` : value;
  return `"${literal.replaceAll('"', '""')}"`;
};

const pad = (value: number, width: number): string => value.toString().padStart(width, "0");

// Pure integer arithmetic keeps ambient clock and locale behavior outside the
// export path while retaining the exact UTC ISO-8601 representation.
const toIsoDate = (submittedAt: number): string => {
  const millis = ((submittedAt % 1000) + 1000) % 1000;
  const totalSeconds = Math.floor(submittedAt / 1000);
  const secondOfDay = ((totalSeconds % 86400) + 86400) % 86400;
  const seconds = secondOfDay % 60;
  const minutes = Math.floor(secondOfDay / 60) % 60;
  const hours = Math.floor(secondOfDay / 3600);
  const z = Math.floor(totalSeconds / 86400) + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPart = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPart + 2) / 5) + 1;
  const month = monthPart < 10 ? monthPart + 3 : monthPart - 9;
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}Z`;
};

/**
 * Serializes activity with quoted cells and neutralizes spreadsheet formulas in
 * every untrusted text field.
 */
export const activityToCsv = (entries: readonly ActivityCsvEntry[]): string =>
  [
    CSV_HEADER,
    ...entries.map((entry) =>
      [
        toIsoDate(entry.submittedAt),
        entry.networkId,
        entry.accountId,
        entry.kind,
        entry.status,
        entry.amount ?? "",
        entry.token ?? "",
        entry.counterparty ?? "",
        entry.hash,
        entry.summary,
      ]
        .map(csvField)
        .join(","),
    ),
  ].join("\n");
