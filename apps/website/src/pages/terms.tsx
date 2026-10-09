import { SiteShell } from "../components/site-shell";
import termsSource from "../content/terms.md?raw";
import { renderMarkdown, termsBody } from "./terms-render";

/**
 * The document's own effective date, taken from the Terms text so it stays
 * fixed until the Terms change rather than tracking the build.
 */
const LAST_UPDATED = "2 October 2026";

export const TermsPage = () => (
  <SiteShell active="terms">
    <main className="docs-main" id="main-content">
      <div className="docs-layout">
        <article className="docs-content policy-content">
          <section className="reading-hero">
            <h1>Terms of Use</h1>
            <p className="policy-meta">Last updated: {LAST_UPDATED}</p>
          </section>
          {renderMarkdown(termsBody(termsSource))}
        </article>
      </div>
    </main>
  </SiteShell>
);
