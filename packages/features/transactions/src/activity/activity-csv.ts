/** Formula-safe CSV export for persisted wallet activity. */

import { explorerTransactionUrl } from "@bramble/wallet-model/networks";

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

// Column order is the export contract a spreadsheet imports: the timestamp
// names its UTC zone in the header, the account is the plain address (the
// network is its own column), and the transaction hash sits beside its explorer
// link. The human-readable summary stays last.
const CSV_HEADER =
  "datetimeUtc,networkId,accountAddress,kind,status,amount,token,counterparty,transactionHash,explorerUrl,summary";
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
// export path while retaining an exact UTC calendar date. Milliseconds are
// dropped so every row carries the same second precision, the form a
// spreadsheet reads as a date without conversion; the header names the zone.
const toUtcDateTime = (submittedAt: number): string => {
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
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)} ${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}`;
};

// The stored account id is `<networkId>:<address>`; the network is already its
// own column, so the export shows the plain address an explorer and an
// accountant both use. A value without the separator is passed through.
const accountAddress = (accountId: string): string => {
  const separator = accountId.indexOf(":");
  return separator === -1 ? accountId : accountId.slice(separator + 1);
};

const RECEIVED_SUMMARY = /\b(receive|received)\b/i;

// A transfer's stored summary shortens the counterparty and words its verb by
// where the row came from ("Send" for a local record, "Sent" or "Received" for
// a chain read). The export rebuilds it from the structured fields so every
// transfer names its counterparty in full and reads with one verb, while a row
// that is not a plain transfer, or that is missing a detail, keeps whatever was
// recorded. The stored verb is the direction signal, the same one the feed uses.
const csvSummary = (entry: ActivityCsvEntry): string => {
  if (entry.kind !== "transfer") {
    return entry.summary;
  }
  const amount = entry.amount?.trim();
  const token = entry.token?.trim();
  const counterparty = entry.counterparty?.trim();
  if (!amount || !token || !counterparty) {
    return entry.summary;
  }
  const inbound = RECEIVED_SUMMARY.test(entry.summary);
  return `${inbound ? "Received" : "Sent"} ${amount} ${token} ${inbound ? "from" : "to"} ${counterparty}`;
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
        toUtcDateTime(entry.submittedAt),
        entry.networkId,
        accountAddress(entry.accountId),
        entry.kind,
        entry.status,
        entry.amount ?? "",
        entry.token ?? "",
        entry.counterparty ?? "",
        entry.hash,
        explorerTransactionUrl(entry.networkId, entry.hash) ?? "",
        csvSummary(entry),
      ]
        .map(csvField)
        .join(","),
    ),
  ].join("\n");
