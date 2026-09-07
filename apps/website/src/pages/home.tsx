import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import { SiteShell } from "../components/site-shell";
import { Button } from "../components/ui/button";
import { WalletPreview } from "../components/wallet-preview";
import { chromeStoreUrl } from "../site";

const capabilities = [
  {
    title: "Clear before signing",
    text: "Decoded transaction reviews keep the account, network, assets, fees, and requested action in view before approval.",
  },
  {
    title: "Accounts that fit the work",
    text: "Create OpenZeppelin or Argent accounts, connect a Ledger, and manage true Argent multisig accounts in one wallet.",
  },
  {
    title: "A side panel, not a detour",
    text: "Bramble stays beside the dApp so context survives from connection through confirmation.",
  },
] as const;

const steps = [
  "Choose an OpenZeppelin or Argent account",
  "Back up or restore your wallet",
  "Fund and deploy the account when needed",
  "Connect, review, and sign from the side panel",
] as const;

export const HomePage = () => (
  <SiteShell active="home">
    <main>
      <div className="home-story">
        <section className="hero" data-wallet-screen="home">
          <div className="hero-copy">
            <h1>Bramble keeps Starknet close.</h1>
            <p>
              A clear, capable wallet that stays beside the page you are using. Create accounts,
              understand each request, and coordinate multisig work without losing context.
            </p>
            <div className="hero-actions">
              <Button asChild>
                <a href={chromeStoreUrl} rel="noreferrer" target="_blank">
                  Download now
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href="/docs/">
                  Read the docs
                  <ArrowRight aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>
        </section>

        <aside aria-label="Interactive Bramble wallet preview" className="story-stage">
          <div className="story-stage-sticky">
            <WalletPreview />
          </div>
        </aside>

        <section
          aria-labelledby="capability-title"
          className="capabilities page-section"
          data-wallet-screen="review"
        >
          <div className="section-heading">
            <h2 id="capability-title">Built around the decisions that matter.</h2>
          </div>
          <div className="capability-list">
            {capabilities.map((capability) => (
              <article key={capability.title}>
                <h3>{capability.title}</h3>
                <p>{capability.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="start-title"
          className="start-path page-section"
          data-wallet-screen="deploy"
        >
          <div>
            <h2 id="start-title">From first open to first signature.</h2>
            <p>
              The setup path stays linear, explains when an account needs funding or deployment, and
              returns you to the account you just created.
            </p>
            <a className="text-link" href="/docs/#getting-started">
              Follow the setup guide
              <ArrowRight aria-hidden="true" />
            </a>
          </div>
          <ol>
            {steps.map((step) => (
              <li key={step}>
                <Check aria-hidden="true" />
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="close-title"
          className="closing-section page-section"
          data-wallet-screen="success"
        >
          <div>
            <h2 id="close-title">Your wallet should explain itself.</h2>
            <p>
              Keep the transaction in view, keep the next action obvious, and keep control local.
            </p>
          </div>
          <Button asChild>
            <a href={chromeStoreUrl} rel="noreferrer" target="_blank">
              Download Bramble
              <ArrowUpRight aria-hidden="true" />
            </a>
          </Button>
        </section>
      </div>
    </main>
  </SiteShell>
);
