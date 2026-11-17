/**
 * Sections 1 to 4 of the published privacy policy: introduction, definitions,
 * the Company's controller/processor role, and the information it collects.
 *
 * The prose is the supplied legal text reproduced verbatim. Treat every string
 * here as reviewed copy — edit it only alongside a reviewed change to the
 * policy document itself.
 */
import type { ReactNode } from "react";
import { PolicySection } from "../components/policy-section";

const definitions: readonly (readonly [string, ReactNode])[] = [
  [
    "2.1",
    "“Personal data” refers to any information relating to an identified or identifiable natural person, including names, identification numbers, location data, an online identifier, or to one or more factors specific to the physical, economic, cultural or social identity of a natural person.",
  ],
  ["2.2", "“Company” means Starknet Holdings."],
  [
    "2.3",
    "“Starkscan Website” means the website located at starkscan.co, together with its respective subdomains.",
  ],
  [
    "2.4",
    "“Dead Eye Website” means the website located at deadeye.wtf, together with its respective subdomains.",
  ],
  [
    "2.5",
    "“Bramble Website” means the website located at bramble.fi, together with its respective subdomains.",
  ],
  [
    "2.6",
    "“Websites” means the Starkscan Website, the Dead Eye Website, and the Bramble Website together, including each of their respective subdomains.",
  ],
  ["2.7", "“Cayman DPA” means the Cayman Islands Data Protection Act (2021 Revision)."],
  ["2.8", "“GDPR” means the General Data Protection Regulation (EU) 2016/679."],
  [
    "2.9",
    "“Biographical information and contact information” means full name, residential address and contact details (e.g. email address, telephone number etc.), date of birth, place of birth, gender, and citizenship.",
  ],
  [
    "2.10",
    "“Financial information” means bank account information, wallet addresses, credit card details, details about your source of funds, assets and liabilities, and information relating to economic and trade sanctions lists.",
  ],
  [
    "2.11",
    "“PEP information” means information on whether you (or someone close to you) holds a prominent public function.",
  ],
  ["2.12", "“Starkscan Services” means the services provided via the Starkscan Website."],
  [
    "2.13",
    "“Authentication Data” means GitHub login and profile data, Better Auth session data, including name, email, profile image if provided, provider account ID, session metadata, IP and user agent where captured, workspace metadata, API-key metadata, and API usage or audit metadata collected in connection with the Starkscan Services.",
  ],
  [
    "2.14",
    "“Technical Data” means technical request metadata and online identifiers, e.g. IP and forwarded headers, request IDs, page path or URL, chain ID, analytics and performance telemetry when enabled, cookies, and browser storage used for UX state like sidebar state, recent searches, watchlist, preferences, survey pacing, and cached UI or session state.",
  ],
  [
    "2.15",
    "“Feedback and Bug Report Data” means free-text feedback or bug messages, optional name and email, page URL and context, Sentry event ID, replay/debug context if enabled, and triage metadata.",
  ],
  [
    "2.16",
    "“Contact Information” means any, all of or a combination of the following: full name, email address, telephone number, Telegram handle or such other contact details as provided by you in order to engage in the onboarding process for the Websites and/or provision of voluntary Feedback for said Websites.",
  ],
  [
    "2.17",
    "“Third Party Services” means any third-party account, website, mobile software application or service that is not owned or controlled by the Company, to which the Websites may contain links or enable interaction.",
  ],
  [
    "2.18",
    "“LIA” means a Legitimate Interests Assessment, being a balancing test conducted to ensure that processing based on legitimate interests is necessary and does not override the fundamental rights and freedoms of data subjects.",
  ],
  ["2.19", "“Children” or “Child” means persons under the age of 18."],
  [
    "2.20",
    <>
      “Paid Services” means those Starkscan Services offered via the Starkscan Website designated on
      the{" "}
      <a className="text-link" href="https://starkscan.co/pricing" rel="noreferrer" target="_blank">
        Pricing Page
      </a>{" "}
      as requiring payment, whether accessed through a Subscription or a Token Top-Up.
    </>,
  ],
  [
    "2.21",
    "“Payment Data” means wallet address, payment tx hash, chain, token, amount, payment time or block, workspace credited, wallet-screening result and provider reference, credit balance history, and receipt/invoice metadata, if generated.",
  ],
];

const yourRights = [
  "The right to access your personal data.",
  "The right to correct or update inaccurate or incomplete personal data.",
  "The right to request the deletion of your personal data.",
  "The right to object to or restrict the processing of your personal data.",
  "The right to data portability, which allows you to obtain and reuse your personal data for your own purposes across different services.",
  "The right to withdraw your consent at any time where we rely on your consent to process your personal data.",
  "The right to lodge a complaint with a supervisory authority if you believe we have infringed your data protection rights.",
] as const;

const securityMeasures = [
  "Encryption of personal data during transmission and at rest.",
  "Access control protocols to restrict access to personal data only to authorized personnel.",
  "Regular monitoring and auditing of our security practices.",
  "Secure storage solutions and cybersecurity protections to prevent unauthorized access to systems.",
  "For the Starkscan Website, security measures may also include API authentication, scoped API keys, rate limiting and abuse-prevention controls, audit logs for API-key activity, restricted operator access, secure secrets management, monitoring, and privacy-preserving telemetry or error-reporting settings where applicable.",
] as const;

/** Renders sections 1 to 4 of the policy. */
export const PrivacyCollectionSections = () => (
  <>
    <PolicySection id="introduction">
      <p>
        This privacy policy applies to processing activities performed by the Company in relation to
        the personal data that it collects relating to users of the Websites and in relation to
        developer and ecosystem supports (including potential investments) (“you” or “your” as the
        context requires).
      </p>
      <p>
        Privacy is of the utmost importance to us. Please see below information about how the
        Company manages personal data, and for information about your rights with respect to the
        processing of your personal data.
      </p>
      <p>
        The Company is committed to processing your personal data in accordance with applicable data
        protection laws, including the Cayman DPA, GDPR, and other similar privacy laws where
        applicable. The Company implements appropriate safeguards to ensure that your personal data
        is protected during international transfers and is processed in a lawful, fair, and
        transparent manner.
      </p>
      <p>
        This Privacy Policy covers personal data collected online, through direct interactions, via
        third-party sources, and through blockchain networks where applicable.
      </p>
    </PolicySection>

    <PolicySection id="definitions">
      <p>The following terms are defined as follows:</p>
      <div className="policy-clauses">
        {definitions.map(([number, text]) => (
          <p key={number}>
            <span className="policy-clause-number">{number}</span>
            {text}
          </p>
        ))}
      </div>
    </PolicySection>

    <PolicySection id="controller-or-processor">
      <p>
        The Company acts as a <strong>data controller</strong> under applicable data protection laws
        when it determines the purposes and means of processing your personal data — for example,
        when you apply for a grant, interact with our community initiatives, or communicate directly
        with us.
      </p>
      <p>
        In certain situations, the Company may act as a <strong>joint controller</strong> alongside
        our service providers. In such cases, both parties may determine the purposes and means of
        data processing, and the Company will clarify those responsibilities in our agreements and,
        where applicable, through joint privacy notices.
      </p>
      <p>
        In other instances — such as when the Company uses third-party platforms (e.g., GitHub for
        integrations) — the operators of those platforms may act as{" "}
        <strong>independent data controllers</strong>. Your use of those services will also be
        governed by their own privacy policies.
      </p>
      <p>
        You may contact our Data Protection Officer (or equivalent representative) at{" "}
        <a className="text-link" href="mailto:privacy@starknet.org">
          <strong>privacy@starknet.org</strong>
        </a>{" "}
        for any questions regarding this Privacy Policy or your personal data.
      </p>
    </PolicySection>

    <PolicySection id="information-we-collect">
      <h3>
        Personal Data the Company collects about Developer &amp; Ecosystem Supports (including
        potential investments):
      </h3>
      <p>
        The Company obtains information about you in a number of ways through information provided
        in the course of on-going support to developers, the ecosystem and people who engage with
        us.
      </p>
      <p>
        The minimum information required for entering into a contract governing your interaction
        with us, and for enabling us to comply with our statutory obligations, is Biographical
        information and Contact information, PEP information, and Financial information.
      </p>

      <h3>Information the Company collect about user(s) of the Starkscan Website:</h3>
      <p>
        The Company obtains information about you in a number of ways through your use of the
        Starkscan Website, in order to offer the services provided therein, and depending on which
        services you avail of, the Company may collect Authentication Data and Payment Data. Where
        Technical Data or Feedback and Bug Report Data contains personal data, for example online
        identifiers or information voluntarily provided by you, we process it as described in this
        Privacy Policy and our Cookie Policy.
      </p>

      <h3>Information the Company collect about user(s) of the Bramble Website:</h3>
      <p>
        The Company obtains information about you in a number of ways through your use of the
        Bramble Website, in order to offer the services provided therein, and depending on which
        services you avail of, the Company may collect Financial Information and KYC/AML data. Where
        Technical Data or Feedback and Bug Report Data contains personal data, for example online
        identifiers or information voluntarily provided by you, we process it as described in this
        Privacy Policy and our Cookie Policy.
      </p>

      <h3>Information the Company collect about user(s) of the Websites:</h3>
      <p>
        The Company obtains information about you through the Feedback you voluntarily provide in
        relation to the Websites, in order for us to improve the services provided therein, and
        depending on the means of communication, the Company may collect your Contact Information.
      </p>

      <h3>Information the Company receives about you from other sources:</h3>
      <p>
        The Company also receives information about you from third parties
        <sup>
          <a
            aria-describedby="policy-footnote-1"
            href="#policy-footnote-1"
            id="policy-footnote-ref-1"
          >
            1
          </a>
        </sup>{" "}
        such as our service providers assisting with AML, fraud, and security compliance, and
        through publicly available sources.
      </p>

      <h3>Third Party Links:</h3>
      <p>
        Links to and interaction with third party products. The Websites may enable you to interact
        with or contain links to Third Party Services. The Company is not responsible for the
        privacy practices or the content of such Third Party Services. Please be aware that Third
        Party Services may collect Personal Information from you. Accordingly, the Company
        encourages you to read the terms and conditions and privacy policy of each Third Party
        Service that you choose to use or interact with.
      </p>

      <h3>Conversation Transcripts and Recordings</h3>
      <p>
        We may collect and retain transcripts or recordings of conversations with you, including but
        not limited to email exchanges, chat communications (e.g., via X, Discord or Telegram),
        video calls (e.g., via Zoom or Google Meet), or other communication platforms used in the
        connection with the services offered on the Websites. These records may include your name,
        contact details, time stamps, message content, and other metadata associated with the
        interaction.
      </p>
      <p>
        Such data is collected to facilitate communication, provide support, document
        decision-making, improve services delivery, and meet operational, legal or compliance
        requirements. Where applicable, the Company will notify you in advance when conversations
        may be recorded.
      </p>

      <h3>Your Rights</h3>
      <p>
        Depending on applicable data protection laws, you have the following rights regarding your
        personal data:
      </p>
      <ul>
        {yourRights.map((right) => (
          <li key={right}>{right}</li>
        ))}
      </ul>
      <p>
        To exercise any of these rights, please contact us at{" "}
        <a className="text-link" href="mailto:privacy@starknet.org">
          privacy@starknet.org
        </a>
        .
      </p>

      <h3>Security Measures</h3>
      <p>
        The Company implements industry-standard technical and organizational measures to protect
        your personal data against unauthorized access, loss, misuse, or alteration. These measures
        include but are not limited to:
      </p>
      <ul>
        {securityMeasures.map((measure) => (
          <li key={measure}>{measure}</li>
        ))}
      </ul>
      <p>
        However, please note that no method of transmission over the internet or method of
        electronic storage is completely secure, and the Company cannot guarantee absolute security.
      </p>

      <h3>Where the Company stores personal data:</h3>
      <p>
        For interactions involving users of the Websites and/or external stakeholders such those
        seeking developer and ecosystem supports (including potential investments), the Company may
        store data on platforms such as Google Workspace, Notion, Airtable, DocuSign, HubSpot, and
        other trusted service providers. All vendors are selected based on their privacy and
        security standards and are bound by data processing agreements where applicable.
      </p>
      <p>For the Starkscan Website, we store data on:</p>
      <ul>
        <li>
          Starkscan infrastructure and databases such as our Hetzner-hosted PostgreSQL database and
          server logs: this covers authorised users, sessions, workspace data, API-key metadata,
          API-key audit events, API usage events, feedback triage outbox data, and technical request
          or rate-limit metadata; and
        </li>
        <li>
          GitHub: this covers self-serve login via GitHub OAuth as GitHub is involved for
          authentication and profile/account data.
        </li>
      </ul>

      <h3>Protection of Minors</h3>
      <p>
        The Company does not knowingly collect personal data from individuals under the age of 18.
        If the Company becomes aware that we have inadvertently received personal data from a person
        under 18 years of age without verified parental consent, the Company will delete such
        information from our records. If you believe that the Company might have any information
        from or about a child under 18, please contact us at{" "}
        <a className="text-link" href="mailto:privacy@starknet.org">
          privacy@starknet.org
        </a>
        .
      </p>

      <aside className="policy-footnote">
        <p id="policy-footnote-1">
          <sup>1</sup> Such as Sumsub or such similar service providers that may be engaged by the
          Company from time to time.{" "}
          <a href="#policy-footnote-ref-1">
            <span aria-hidden="true">↩</span>
            <span className="sr-only">Back to the reference in Section 4</span>
          </a>
        </p>
      </aside>
    </PolicySection>
  </>
);
