import { useEffect, useState } from "react";
import { SiteShell } from "../components/site-shell";
import { Button } from "../components/ui/button";
import { WalletPreview } from "../components/wallet-preview";
import { chromeStoreUrl } from "../site";

const features = [
  [
    "Shielded by default.",
    "Your keys stay on your machine. Self-custody, with a seed phrase you own and nobody else can read.",
  ],
  [
    "Super fast transactions.",
    "Starknet's fastest moving wallet. Requests confirm in a breath, and fees stay small enough to forget.",
  ],
  [
    "Every request in plain words.",
    "Read what a call actually does before you sign it. Contracts, amounts and recipients, spelled out.",
  ],
  [
    "Hold, send, stake.",
    "STRK, ETH, USDC and the tokens you collect along the way, all in one balance you can act on.",
  ],
] as const;
const setup = [
  ["Add it to Chrome", "Install from the Chrome Web Store and pin Bramble to the side panel."],
  ["Create an account", "Set a password, then write down your seed phrase. Keep it offline."],
  [
    "Fund it",
    "Send STRK or ETH from an exchange or another wallet, then deploy the account when prompted.",
  ],
  ["Start using Starknet", "Open any dapp and connect. The panel stays beside you."],
] as const;

export const HomePage = () => {
  const [scene, setScene] = useState("hero");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setScene(entry.target.id);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const section of document.querySelectorAll("[data-scene]")) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <SiteShell active="home">
      <main className={`home-main scene-${scene}`} id="main-content">
        <div aria-hidden="true" className="story-background">
          <div className="background-honey" />
          <div className="background-blossom" />
          <div className="background-lavender" />
          <div className="background-sage" />
        </div>
        <div className="home-story">
          <section className="story-section hero" data-scene id="hero">
            <div className="foundation-badge">Built by the Starknet Foundation.</div>
            <h1>
              The wa
              <span className="bird-perch">
                ll
                <img alt="" src="/brand/hero-birds.svg" />
              </span>
              et for
              <br />
              everything Starknet.
            </h1>
            <p className="story-lead">
              Store and shield your crypto in a self-custody wallet made for Starknet. Create
              accounts, understand every request before you sign, and shield what you hold, all
              beside the page you are using.
            </p>
            <div className="hero-actions">
              <Button asChild className="button-large">
                <a href="#download">Download now</a>
              </Button>
              <Button asChild className="button-large button-ink">
                <a href="/docs/">Read the docs</a>
              </Button>
              <a
                className="text-link"
                href="https://starkscan.co/"
                rel="noreferrer"
                target="_blank"
              >
                Open Starkscan
              </a>
            </div>
          </section>
          <aside className="story-stage">
            <div className="story-stage-sticky">
              <WalletPreview />
            </div>
          </aside>
          <section className="story-section" data-scene id="features">
            <h2>Made for Starknet, top to tail.</h2>
            <p className="story-lead">
              Everything you need in one wallet. No bridges, no browser tabs to chase, no signing
              blind.
            </p>
            <div className="feature-grid">
              {features.map(([title, copy]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </section>
          <section className="story-section" data-scene id="panel">
            <h2>Beside the page, not on top of it.</h2>
            <p className="story-lead">
              Bramble lives in the Chrome side panel. It stays open while you move around a dapp, so
              your balance and every pending request are one glance away.
            </p>
            <ol className="panel-list">
              <li>Persistent panel. Nothing disappears behind a popup.</li>
              <li>Transaction review in full, with the calls broken out.</li>
              <li>Switch accounts without leaving the dapp.</li>
            </ol>
          </section>
          <section className="story-section setup-section" data-scene id="setup">
            <h2>Set up in about a minute.</h2>
            <ol className="setup-grid">
              {setup.map(([title, copy]) => (
                <li key={title}>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </li>
              ))}
            </ol>
            <img alt="" className="setup-birds" loading="lazy" src="/brand/setup-birds.svg" />
          </section>
        </div>
        <section className="download-section" id="download">
          <div>
            <h2>Your wallet should explain itself.</h2>
            <p className="story-lead">
              See what you sign, shield what you hold, and keep local control of your keys.
            </p>
            <Button asChild className="button-large button-cream">
              <a href={chromeStoreUrl} rel="noreferrer" target="_blank">
                Download Now
              </a>
            </Button>
          </div>
        </section>
      </main>
    </SiteShell>
  );
};
