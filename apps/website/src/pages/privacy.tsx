import { SiteShell } from "../components/site-shell";
import { PrivacyCollectionSections } from "../content/privacy-collection";
import { PrivacyProcessingSections } from "../content/privacy-processing";
import { PrivacyRightsSections } from "../content/privacy-rights";
import { PRIVACY_SECTIONS, privacySectionNavLabel } from "../content/privacy-sections";

/**
 * Date the published policy last changed. It is the document's own effective
 * date, not a build timestamp, so it stays fixed until the policy text changes.
 */
const LAST_UPDATED = "11 September 2026";

export const PrivacyPage = () => (
  <SiteShell active="privacy">
    <main className="docs-main" id="main-content">
      <div className="docs-layout">
        <aside className="docs-index">
          <nav aria-label="On this page">
            <strong>Table of contents</strong>
            {PRIVACY_SECTIONS.map((section) => (
              <a href={`#${section.id}`} key={section.id}>
                {section.number}. {privacySectionNavLabel(section)}
              </a>
            ))}
          </nav>
        </aside>

        <article className="docs-content policy-content">
          <section className="reading-hero">
            <h1>Privacy policy</h1>
            <p className="policy-meta">Last updated: {LAST_UPDATED}</p>
          </section>
          <PrivacyCollectionSections />
          <PrivacyProcessingSections />
          <PrivacyRightsSections />
        </article>
      </div>
    </main>
  </SiteShell>
);
