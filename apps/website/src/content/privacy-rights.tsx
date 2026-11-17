/**
 * Sections 9 to 15 of the published privacy policy: retention, cookies, your
 * rights, changes, children, contact, and data protection authorities.
 *
 * The prose is the supplied legal text reproduced verbatim. Treat every string
 * here as reviewed copy — edit it only alongside a reviewed change to the
 * policy document itself.
 */
import { PolicySection, PolicyTable } from "../components/policy-section";

const retentionHeaders = ["Data Type", "Examples", "Purpose", "Retention Period"] as const;

const retentionRows = [
  [
    "KYC/AML data",
    "ID, wallet address, source of funds, sanctions screening data such as IP address, location, name, address and DOB.",
    "Compliance, anti-fraud",
    "UK & Cayman - 5 years after the end of the business relationship\nEU - 7 years after the end of the business relationship",
  ],
  [
    "Contract data",
    "Name, address, email contained in contracts, GitHub login and profile data, Better Auth session data, for instance, name, email, profile image if provided, provider account ID, session metadata, IP and user agent where captured, workspace metadata, API-key metadata, and API usage or audit metadata.",
    "Legal, audit, dispute management",
    "UK & Cayman - 6 years after termination\nEU - 10 years after termination",
  ],
  [
    "Payment data",
    "Payer wallet address, payment tx hash, chain, token, amount, payment time or block, workspace credited, wallet-screening result and provider reference, credit balance history, and receipt/invoice metadata if generated.",
    "Tax, accounting",
    "UK - 6 years. EU - 10 years. Cayman Islands - 5 years.",
  ],
  [
    "Communications Data",
    "Emails, chat logs, meeting notes.",
    "Documentation, support",
    "UK, EU & Cayman - 6 years",
  ],
  [
    "Marketing Data",
    "Email, preferences, sign-up info.",
    "Websites & services updates",
    "UK, EU & Cayman - 2 years or until opt-out",
  ],
  [
    "Cookies Data",
    "Technical request data, analytics, browser storage data",
    "Websites functionality, analytics and enhancing of user experience",
    "UK, EU & Cayman - 6 months",
  ],
] as const;

const objectionGrounds = [
  "Relying on our own or someone else’s legitimate interests to process your personal data except if the Company can demonstrate compelling legal grounds for the processing or for the establishment, exercise or defence of legal claims;",
  "Processing your personal data for direct marketing; or",
  "Processing your personal data for research unless the Company reasonably believes such processing is necessary for the performance of a task carried out for reasons of public interest (such as by a regulatory or enforcement agency).",
] as const;

const authorities = [
  {
    residents: "For residents of the Cayman Islands:",
    name: "Office of the Ombudsman",
    lines: [
      "3rd Floor, Anderson Square",
      "Shedden Road, George Town",
      "Grand Cayman, Cayman Islands",
      "P.O. Box 2252",
    ],
  },
  {
    residents: "For residents of the United Kingdom:",
    name: "The Information Commissioner’s Office",
    lines: ["Wycliffe House, Water Ln", "Wilmslow SK9 5AF, UK"],
  },
  {
    residents: "For residents of Portugal:",
    name: "CNPD - Comissão Nacional de Proteção de Dados",
    lines: ["Av. D. Carlos I, 134, 1º", "1200-651 Lisboa", "Portugal"],
  },
] as const;

/** Renders sections 9 to 15 of the policy. */
export const PrivacyRightsSections = () => (
  <>
    <PolicySection id="data-retention">
      <p>
        When personal data is no longer necessary for the purposes for which it may lawfully be
        processed, the Company will remove any details that will identify you, or the Company will
        securely destroy the relevant records. The Company may need to maintain records for a
        significant period of time after you cease being a user or investment applicant for legal or
        regulatory reasons, for example when the Company needs to retain information to help manage
        a dispute or legal claim.
      </p>
      <p>
        If you have opted out of receiving marketing communications the Company will hold your
        details on our suppression list so that the Company knows you do not want to receive these
        communications.
      </p>
      <p>The Company may keep your personal data for periods in line with the below table:</p>
      <PolicyTable
        caption="Retention periods by data type"
        headers={retentionHeaders}
        rows={retentionRows}
      />
    </PolicySection>

    <PolicySection id="cookies">
      <p>To learn more about cookies and why we collect them, read our cookies policy.</p>
    </PolicySection>

    <PolicySection id="your-rights">
      <p>
        The rights that are available to you in relation to the personal data of the Company process
        are outlined below. You may request to exercise these rights subject to any limitations
        provided for under applicable data protection laws.
      </p>
      <p>
        <strong>Access:</strong> You can ask us to confirm whether the Company is processing your
        personal data and, if so, what information the Company processes and to provide you with a
        copy of that information.
      </p>
      <p>
        <strong>Rectification:</strong> It is important to us that your personal data is up to date.
        The Company will take all reasonable steps to make sure that your personal data remains
        accurate, complete and up-to-date. Please inform us if your personal data changes. If the
        personal data the Company holds about you is inaccurate or incomplete, you are entitled to
        have it rectified. If the Company has disclosed your personal data to others, the Company
        will let them know about the rectification where possible. If you ask us, and if possible
        and lawful to do so, the Company will also inform you with whom the Company has shared your
        personal data.
      </p>
      <p>
        You may inform us at any time that your personal details have changed by emailing us at{" "}
        <a className="text-link" href="mailto:privacy@starknet.org">
          privacy@starknet.org
        </a>
        . Subject to applicable law, the Company will change your personal data in accordance with
        your instructions. To proceed with such requests, in some cases the Company may need
        supporting documents from you as proof i.e. personal data that the Company is required to
        keep for regulatory or other legal purposes.
      </p>
      <p>
        <strong>Erasure:</strong> You can ask us to delete or remove your personal data in certain
        circumstances. Such requests may be subject to any retention limits the Company are required
        to comply with in accordance with applicable laws and regulations. If the Company has
        disclosed your personal data to others, the Company will let them know about the erasure
        request where possible. If you ask us, and if possible and lawful to do so, the Company will
        also inform you with whom the Company has shared your personal data.
      </p>
      <p>
        <strong>Processing restrictions:</strong> You can ask us to block or suppress the processing
        of your personal data in certain circumstances such as if you contest the accuracy of that
        personal data or object to us processing it. It will not stop us from storing your personal
        data. If the Company has disclosed your personal data to others, the Company will let them
        know about the restriction of processing if possible. If you ask us, and if possible and
        lawful to do so, the Company will also inform you with whom the Company has shared your
        personal data.
      </p>
      <p>
        <strong>Data portability:</strong> In certain circumstances you may have the right to obtain
        personal data you have provided to us, in a structured, commonly used and machine-readable
        format, and to re-use it elsewhere or ask us to transfer this to a third party of your
        choice, where technically feasible.
      </p>
      <p>
        <strong>Objection:</strong> You can ask us to stop processing your personal data, and the
        Company will do so, if the Company are:
      </p>
      <ul>
        {objectionGrounds.map((ground) => (
          <li key={ground}>{ground}</li>
        ))}
      </ul>
      <p>
        <strong>Automated decision-making and profiling:</strong> If the Company has made a decision
        about you based solely on an automated process (e.g. through automatic profiling) that
        affects your ability to access our programmes or initiatives or has another significant
        effect on you, you can request not to be subject to such a decision unless the Company can
        demonstrate to you that such decision is necessary for entering into, or the performance of,
        a contract between you and us. Even if a decision is necessary for entering into or
        performing a contract, you may contest the decision and require human intervention. The
        Company may not be able to offer our programmes or initiatives to you, if the Company agrees
        to such a request (i.e. end our relationship with you).
      </p>
      <p>
        <strong>Complaints:</strong> You have the right to complain to a competent data protection
        authority. Contact details are set out in Section 15 below. The Company asks that you first
        contact{" "}
        <a className="text-link" href="mailto:privacy@starknet.org">
          privacy@starknet.org
        </a>{" "}
        to give us an opportunity to address any concerns.
      </p>
      <p>
        <strong>Withdraw consent:</strong> You have the right to withdraw consent to processing
        based on consent at any time. Note this will not affect the lawfulness of processing based
        on consent prior to the withdrawal of consent or on grounds where consent is not required.
      </p>
    </PolicySection>

    <PolicySection id="changes">
      <p>
        Our privacy notice is reviewed and updated regularly in light of new regulations,
        technologies, and any changes to our business operations. Any personal data the Company
        processes will be governed by our most recent privacy notice. Please review this privacy
        notice from time to time. The Company will publish any material changes to this privacy
        notice on the Websites.
      </p>
      <p>
        The Company will notify you of material changes in a timely manner and, where appropriate
        prior to the change taking effect via note on the Websites or direct communication where
        appropriate.
      </p>
    </PolicySection>

    <PolicySection id="children">
      <p>
        Neither the Websites, the services offered therein, nor the ecosystem supports (including
        possible investments) are directed at Children and the Company does not knowingly collect
        personal data from children. If the Company learns that the Company has inadvertently
        processed personal data from a child, the Company will take legally permissible measures to
        remove that data from our records. The Company will not allow the Child to apply or enter
        into any form of support programme. If you are a parent or guardian of a Child, and you
        become aware that a Child has provided personal data to us, please contact us at{" "}
        <a className="text-link" href="mailto:privacy@starknet.org">
          privacy@starknet.org
        </a>
        .
      </p>
      <p>
        To help enforce this policy, the Company applies age-screening or confirmation steps (e.g.,
        “18+ only” disclaimers) on the Websites and in the case of possible investments confirms via
        Know your customer processes. If the Company relies on third-party platforms (e.g., social
        media channels), the Company expects those platforms to enforce their own age restrictions
        under their terms of service.
      </p>
    </PolicySection>

    <PolicySection id="contact">
      <p>
        Any questions, complaints, comments and requests regarding this privacy notice are welcome
        and should be addressed to{" "}
        <a className="text-link" href="mailto:privacy@starknet.org">
          privacy@starknet.org
        </a>
        .
      </p>
    </PolicySection>

    <PolicySection id="data-protection-authorities">
      <p>
        If you are not satisfied with our response to your complaint, you have the right to submit a
        complaint to a competent data protection authority. You may complain to your local
        supervisory authority or to our lead supervisory authority the Portuguese Data Protection
        Commission. Examples of relevant data protection authorities are listed below:
      </p>
      <div className="policy-authorities">
        {authorities.map((authority) => (
          <div key={authority.residents}>
            <h3>{authority.residents}</h3>
            <address>
              <strong>{authority.name}</strong>
              {authority.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </address>
          </div>
        ))}
      </div>
    </PolicySection>
  </>
);
