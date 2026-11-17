/**
 * Owns the numbered structure of the published privacy policy.
 *
 * The on-page index, the section headings, and the anchor ids all read this
 * list, so a section cannot be renamed, renumbered, or reordered in one place
 * and left stale in another. Wording here is the supplied legal text: change it
 * only alongside a reviewed change to the policy itself.
 */

type PrivacySection = {
  /** Anchor id; also the value passed to `PolicySection`. */
  readonly id: string;
  /** Clause number as it appears in the source document. */
  readonly number: number;
  /** Section heading, verbatim from the source document. */
  readonly heading: string;
  /** Shorter label for the on-page index, where the full heading does not fit. */
  readonly navLabel?: string;
};

/** Every section of the policy, in document order. */
export const PRIVACY_SECTIONS = [
  { id: "introduction", number: 1, heading: "Introduction" },
  { id: "definitions", number: 2, heading: "Definitions" },
  {
    id: "controller-or-processor",
    number: 3,
    heading: "Our Role as Data Controller or Data Processor",
    navLabel: "Controller or processor",
  },
  {
    id: "information-we-collect",
    number: 4,
    heading: "Information we collect about you from time to time",
    navLabel: "Information we collect",
  },
  {
    id: "legal-justification",
    number: 5,
    heading: "Our legal justification for processing personal data",
    navLabel: "Legal justification",
  },
  {
    id: "disclosure",
    number: 6,
    heading: "Disclosure of your personal data",
    navLabel: "Disclosure",
  },
  {
    id: "international-transfers",
    number: 7,
    heading:
      "For UK & EEA clients: Transfers of personal data outside of the European Economic Area (EEA) and the United Kingdom (UK)",
    navLabel: "Transfers outside the EEA & UK",
  },
  {
    id: "blockchain-privacy",
    number: 8,
    heading: "Privacy when using digital assets and blockchains",
    navLabel: "Digital assets and blockchains",
  },
  { id: "data-retention", number: 9, heading: "Data retention" },
  { id: "cookies", number: 10, heading: "Cookies" },
  {
    id: "your-rights",
    number: 11,
    heading: "Your rights regarding your personal data",
    navLabel: "Your rights",
  },
  {
    id: "changes",
    number: 12,
    heading: "Changes to this privacy notice",
    navLabel: "Changes to this notice",
  },
  {
    id: "children",
    number: 13,
    heading: "Our products and services are not available to children",
    navLabel: "Not available to children",
  },
  { id: "contact", number: 14, heading: "Contact information" },
  {
    id: "data-protection-authorities",
    number: 15,
    heading: "Data Protection Authorities",
    navLabel: "Data protection authorities",
  },
] as const satisfies readonly PrivacySection[];

/** Anchor ids a policy section may be rendered under. */
export type PrivacySectionId = (typeof PRIVACY_SECTIONS)[number]["id"];

const byId = new Map(PRIVACY_SECTIONS.map((section) => [section.id as string, section]));

/**
 * Resolves a registered section. Throws on an unregistered id so a mistyped
 * anchor fails the build's own tests rather than rendering a headingless block.
 */
export const privacySection = (id: PrivacySectionId): PrivacySection => {
  const section = byId.get(id);
  if (section === undefined) {
    throw new Error(`Unregistered privacy section: ${id}`);
  }
  return section;
};

/** Label for the on-page index: the short form when the heading needs one. */
export const privacySectionNavLabel = (section: PrivacySection): string =>
  section.navLabel ?? section.heading;
