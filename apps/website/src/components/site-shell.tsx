import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { chromeStoreUrl } from "../site";
import { Brand } from "./brand";
import { Button } from "./ui/button";

type SiteShellProps = {
  readonly active: "docs" | "home" | "privacy" | "support";
  readonly children: ReactNode;
};

const navigation = [
  { href: "/docs/", id: "docs", label: "Docs" },
  { href: "/support/", id: "support", label: "Support" },
] as const;

export const SiteShell = ({ active, children }: SiteShellProps) => (
  <div className={`site-shell site-shell--${active}`}>
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
          <ArrowUpRight aria-hidden="true" />
        </a>
      </Button>
    </header>
    {children}
    <footer className="site-footer">
      <div>
        <Brand />
        <p>A Starknet wallet for Chrome.</p>
      </div>
      <nav aria-label="Footer navigation">
        <a href="/docs/">Docs</a>
        <a href="/support/">Support</a>
        <a href="/privacy/">Privacy</a>
        <a href="https://github.com/starknet-innovation/mc-wallet">Source</a>
      </nav>
    </footer>
  </div>
);
