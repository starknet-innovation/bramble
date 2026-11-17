import type { ReactNode } from "react";
import { REPOSITORY_URL } from "../lib/site-links";
import { chromeStoreUrl } from "../site";
import { Brand } from "./brand";
import { Button } from "./ui/button";

type SiteShellProps = {
  readonly active: "docs" | "home" | "privacy" | "support" | "terms";
  readonly children: ReactNode;
};

const navigation = [
  { href: "/", id: "home", label: "Home" },
  { href: "/docs/", id: "docs", label: "Docs" },
  { href: "/support/", id: "support", label: "Support" },
] as const;

export const SiteShell = ({ active, children }: SiteShellProps) => (
  <div className={`site-shell site-shell--${active}`}>
    <a className="skip-link" href="#main-content">
      Skip to content
    </a>
    <header className="site-header">
      <Brand />
      <nav aria-label="Primary navigation" className="site-nav">
        {navigation.map((item) => (
          <a aria-current={active === item.id ? "page" : undefined} href={item.href} key={item.id}>
            {item.label}
          </a>
        ))}
      </nav>
      <Button asChild className="header-download">
        <a href={chromeStoreUrl} rel="noreferrer" target="_blank">
          Download now
        </a>
      </Button>
    </header>
    {children}
    <footer className="site-footer">
      {active === "home" ? (
        <div className="footer-columns">
          <div>
            <Brand />
            <p>Starknet&apos;s fastest moving wallet. Store and shield your crypto.</p>
          </div>
          <nav aria-label="Product">
            <h2>Product</h2>
            <a href="/#features">Features</a>
            <a href="/#setup">Set up</a>
            <a href="/#download">Download</a>
          </nav>
          <nav aria-label="Developers">
            <h2>Developers</h2>
            <a href="/docs/">Docs</a>
            <a href="https://starkscan.co/">Starkscan</a>
            <a href={REPOSITORY_URL}>GitHub</a>
          </nav>
          <nav aria-label="More">
            <h2>More</h2>
            <a href="/support/">Support</a>
            <a href="/privacy/">Privacy Policy</a>
            <a href="/terms/">Terms of Use</a>
            <a href={`${REPOSITORY_URL}/security/policy`}>Security</a>
          </nav>
        </div>
      ) : (
        <Brand />
      )}
      <div className="footer-bottom">
        <p>Built by the Starknet Foundation.</p>
        {active === "home" ? (
          <p>Learn more at bramble.fi</p>
        ) : (
          <a href="/privacy/">Privacy Policy</a>
        )}
      </div>
      <div className="footer-disclaimer">
        <p>
          This content is for informational purposes only and should not be construed as investment,
          legal, or financial advice. It does not constitute an offer to sell or a solicitation to
          buy, and is not an endorsement of any product. Starknet does not provide custody of any
          assets. The wallet is self-custodial and users are solely responsible for securing their
          keys and assets. Participation may involve risk. Users should review and make themselves
          aware of the risks and warnings set out in the <a href="/terms/">Terms and Conditions</a>.
        </p>
        <p>
          Where users make use of the privacy features, participation will involve screening at
          points of entry, and complete privacy cannot be guaranteed, since certain activity may be
          visible through a viewing key where required for regulatory purposes.
        </p>
      </div>
    </footer>
  </div>
);
