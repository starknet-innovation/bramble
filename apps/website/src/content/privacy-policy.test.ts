/** Keeps the published privacy policy complete, correctly indexed, and verbatim in the clauses that name us. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  PRIVACY_SECTIONS,
  type PrivacySectionId,
  privacySection,
  privacySectionNavLabel,
} from "./privacy-sections";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");
const contentSources = [
  read("./privacy-collection.tsx"),
  read("./privacy-processing.tsx"),
  read("./privacy-rights.tsx"),
];
const policyBody = contentSources.join("\n");
const renderedIds = [...policyBody.matchAll(/<PolicySection id="([^"]+)">/g)].map(
  (match) => match[1],
);

test("every registered section is rendered exactly once, in document order", () => {
  expect(renderedIds).toEqual(PRIVACY_SECTIONS.map((section) => section.id));
});

test("section numbers run 1 to 15 without a gap", () => {
  expect(PRIVACY_SECTIONS.map((section) => section.number)).toEqual(
    Array.from({ length: 15 }, (_, index) => index + 1),
  );
});

test("the page indexes the registry rather than a second hand-written list", () => {
  const page = read("../pages/privacy.tsx");
  expect(page).toContain("PRIVACY_SECTIONS.map");
  expect(page).not.toMatch(/href="#(introduction|definitions|cookies)"/);
});

test("an unregistered section id fails loudly instead of rendering unlabelled", () => {
  expect(() => privacySection("not-a-section" as PrivacySectionId)).toThrow(
    "Unregistered privacy section: not-a-section",
  );
});

test("the index label falls back to the full heading when no short form is given", () => {
  expect(privacySectionNavLabel(privacySection("cookies"))).toBe("Cookies");
  expect(privacySectionNavLabel(privacySection("international-transfers"))).toBe(
    "Transfers outside the EEA & UK",
  );
});

test("the definitions name this site and keep the other two Websites intact", () => {
  expect(policyBody).toContain(
    "“Bramble Website” means the website located at bramble.fi, together with its respective subdomains.",
  );
  expect(policyBody).toContain("“Starkscan Website” means the website located at starkscan.co");
  expect(policyBody).toContain("“Dead Eye Website” means the website located at deadeye.wtf");
  expect(policyBody).toContain("“Company” means Starknet Holdings.");
});

test("every route to exercise a data right points at the published contact address", () => {
  expect(policyBody).not.toMatch(/mailto:(?!privacy@starknet\.org)/);
  expect(policyBody).toMatch(/mailto:privacy@starknet\.org/);
});

test("both reference tables keep every row supplied in the policy", () => {
  const collection = contentSources[1] ?? "";
  const rights = contentSources[2] ?? "";
  expect(collection.match(/"To [^"]+/g)?.length).toBe(12);
  expect(collection).toContain('"For internal business purposes and recordkeeping."');
  expect(
    rights.match(/^ {4}"(KYC\/AML|Contract|Payment|Communications|Marketing|Cookies) /gm)?.length,
  ).toBe(6);
});

test("the cookie sentence stays plain text while no cookie policy is published", () => {
  const cookies = policyBody.slice(policyBody.indexOf('<PolicySection id="cookies">'));
  const section = cookies.slice(0, cookies.indexOf("</PolicySection>"));
  expect(section).toContain("read our cookies policy.");
  expect(section).not.toContain("href");
});
