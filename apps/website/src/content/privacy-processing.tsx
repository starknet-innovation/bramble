/**
 * Sections 5 to 8 of the published privacy policy: legal justification,
 * disclosure, international transfers, and blockchain privacy.
 *
 * The prose is the supplied legal text reproduced verbatim. Treat every string
 * here as reviewed copy — edit it only alongside a reviewed change to the
 * policy document itself.
 */
import { PolicySection, PolicyTable } from "../components/policy-section";

const ADEQUACY_DECISIONS_URL =
  "https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en";

const legalBasisHeaders = [
  "Why the Company processes your personal data",
  "Legal Justification",
  "Categories of personal data",
] as const;

const legalBasisRows = [
  [
    "To enter agreements with ecosystem teams providing supports and/or investments.",
    "Performance of a contract and anti-money laundering laws.",
    "Biographical information and contact information, financial information, PEP information (where relevant), verification information and other information.",
  ],
  [
    "To conduct or arrange for the conducting of identity checks",
    "Legal obligation to comply with “Know your customer” and customer due diligence regulatory obligations. Such processing is also in our legitimate interest to prevent and detect potential crime and/or fraud and to protect our business.",
    "Biographical information and contact information, financial information, PEP information (where relevant), verification information and other information.",
  ],
  [
    "To verify your identity and comply with legal obligations, including responding to subpoenas, court orders, and other judicial processes, fulfilling tax and regulatory reporting requirements, and supporting internal risk management and compliance procedures.",
    "Legal obligation; legitimate interests in ensuring transparency and legal compliance.",
    "Biographical information and contact information, financial information, PEP information (where relevant), verification information and other information.",
  ],
  [
    "To market our Websites and the services offered therein.",
    "Consent, where you have agreed to receive marketing messages directly. The Company relies upon our legitimate interest to process information about how our services and the Websites are used to decide on marketing strategies.",
    "Biographical information and contact information, other information and browser information.",
  ],
  [
    "To conduct surveys.",
    "It is in our legitimate interest to send you surveys and conduct such surveys in order to gather information on how the Websites and the services offered therein are working for you and how to improve them. Your participation in those surveys will be on the basis of your consent.",
    "Biographical information and Contact Information, other information and browser information.",
  ],
  [
    "For internal business purposes and recordkeeping.",
    "The Company has legal obligations to keep certain records. Such processing is in our legitimate interest for internal business and research purposes as well as for record keeping purposes. It is also in our legitimate interest to keep records to ensure that you comply with your contractual obligations pursuant to the agreement governing our relationship with you.",
    "Biographical information and contact information, financial information, verification information, other information and browser information.",
  ],
  [
    "To establish, enforce, or defend our legal rights, including initiating or responding to legal proceedings, managing disputes, or addressing claims before courts, regulatory bodies, or other competent authorities.",
    "Legitimate interests in protecting the Company’s legal rights and resolving disputes",
    "Biographical information and contact information, financial information, verification information, other information and browser information.",
  ],
  [
    "To notify you of changes to the services offered via the Websites and/or to laws and regulatory rules and regulations",
    "Legal obligation. Often the law requires us to advise you of certain changes to the services offered via the Websites or laws related thereto. The Company may need to inform you of changes to the terms or the features of the services offered via the Websites. The Company needs to process your personal data to send you these legal notifications. You will continue to receive this information from us even if you choose not to receive direct marketing information from us. Where such notification is not legally required, it may be in our legitimate interest to notify you of such changes.",
    "Biographical information and contact information, financial information, and other information.",
  ],
  [
    "To administer and secure our operations, including maintaining IT and system security, implementing access controls, and detecting or preventing fraud and other potential threats.",
    "Legitimate interests in ensuring the security and integrity of our systems, data, and infrastructure.",
    "Biographical information and contact information, financial information, verification information, other information and browser information",
  ],
  [
    "To tailor the Websites and the services offered therein to better align with your needs and preferences, and to ensure continuity in our engagement with you.",
    "Legitimate interests in delivering relevant support and improving the effectiveness of the Websites and the services offered therein.",
    "Other information, browser information and log information.",
  ],
  [
    "To communicate with you.",
    "It is in our legitimate interest to communicate with users of the Websites and investment applicant(s) to ensure the effective delivery of the Websites and the services offered therein and to fulfill the objectives of the Company.",
    "Biographical information and contact information, financial information and other information.",
  ],
  [
    "To receive services from third parties including services such as administrative, legal, tax, compliance, insurance, IT, analytics, identity verification, research or other services.",
    "It is generally in our legitimate interest to receive such services from third parties to ensure the effective delivery of Websites and the services offered therein.",
    "Biographical information and contact information, financial information, PEP information (where relevant), verification information, other information, browser information.",
  ],
  [
    "To enable us to provide the Starkscan Services to you.",
    "It is generally in our legitimate interests to enable us to provide the Starkscan Services to you by allowing us to authenticate users, process payment for Paid Services and manage API permissions, rate limits, manage workspaces and to maintain security and audit trails.",
    "Authentication Data, Payment Data, Technical Data or Feedback and Bug Report Data (where relevant).",
  ],
] as const;

/** Renders sections 5 to 8 of the policy. */
export const PrivacyProcessingSections = () => (
  <>
    <PolicySection id="legal-justification">
      <p>
        When relying on our legitimate interests as a legal basis for processing your personal data,
        the Company has conducted an LIA to ensure that such processing is necessary and does not
        override your fundamental rights and freedoms. Our legitimate interests include supporting
        and operating the Websites, ensuring security of the Websites, enabling us to provide and
        perform our services to you and fostering ecosystem development.
      </p>
      <PolicyTable
        caption="Why the Company processes personal data, the legal justification, and the categories involved"
        headers={legalBasisHeaders}
        rows={legalBasisRows}
      />
    </PolicySection>

    <PolicySection id="disclosure">
      <h3>6.1 Service Providers and Data Processors</h3>
      <p>
        The Company may disclose your personal data to third-party service providers who process
        data on our behalf and under our instructions. These may include vendors that provide
        services such as identity verification, cloud storage, IT support, analytics, KYC/AML
        compliance, and security monitoring.
      </p>
      <p>
        These service providers are contractually obligated to handle your data in compliance with
        applicable data protection laws and only for the purposes the Company instructs. They act as
        our <em>data processors</em> under GDPR and similar laws.
      </p>
      <p>
        The Company may also disclose personal data when it is compelled by law, for example to a
        government agency as a result of a valid court order.
      </p>
    </PolicySection>

    <PolicySection id="international-transfers">
      <p>
        The Company may transfer your personal data outside the EEA and UK to affiliated entities,
        service providers and business partners. Transfers outside of the EEA or the UK (as
        appropriate) are done in accordance with lawful transfer mechanisms. If personal data is
        transferred to a country which has been found by the European Commission to have an
        essentially equivalent standard of data protection to the EEA, then the Company may rely on
        an ‘adequacy decision’ to transfer that personal data. See{" "}
        <a
          aria-label="List of countries with a European Commission adequacy decision"
          className="text-link"
          href={ADEQUACY_DECISIONS_URL}
          rel="noreferrer"
          target="_blank"
        >
          <strong>here</strong>
        </a>{" "}
        for a list of countries with adequacy decisions. If personal data is transferred from the
        EEA or UK to the US, the Company may rely on standard contractual clauses.
      </p>
      <p>
        Transfers of personal data outside the European Economic Area (EEA) and the United Kingdom
        (UK) are carried out in compliance with applicable data protection laws. Where no adequacy
        decision exists, the Company uses appropriate safeguards, including Standard Contractual
        Clauses (SCCs) approved by the European Commission, or other lawful transfer mechanisms.
      </p>
    </PolicySection>

    <PolicySection id="blockchain-privacy">
      <p>
        Your use of digital assets may be recorded on a public blockchain. Public blockchains are
        distributed ledgers, intended to immutably record transactions across wide networks of
        computer systems. Many blockchains are open to forensic analysis which can lead to
        re-identification of transacting individuals and the revelation of personal data, especially
        when blockchain data is combined with other data.
      </p>
      <p>
        As blockchains are decentralized or third-party networks which are not controlled or
        operated by us, the Company is not able to erase, modify, or alter personal data on such
        networks. Please avoid including personal data in blockchain transactions or metadata where
        it is not strictly necessary. Blockchains are immutable and public by design, and data
        written to a blockchain generally cannot be modified or deleted. Where you choose to store
        or transmit data on-chain, you should ensure that it does not contain personal information
        or sensitive data that may infringe upon your privacy rights.
      </p>
    </PolicySection>
  </>
);
