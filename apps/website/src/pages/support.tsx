import { ArrowRight, ArrowUpRight, BookOpen, Bug, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { SiteShell } from "../components/site-shell";
import { Button } from "../components/ui/button";
import { createSupportIssueUrl, REPOSITORY_URL } from "../lib/site-links";

const supportRoutes = [
  {
    description: "Installation, account setup, transactions, dApps, multisig, and privacy.",
    href: "/docs/",
    icon: BookOpen,
    label: "Read the wallet guide",
  },
  {
    description: "Share clear reproduction steps for a problem in the extension.",
    href: `${REPOSITORY_URL}/issues/new`,
    icon: Bug,
    label: "Report a problem",
  },
  {
    description: "Use the private reporting route for a vulnerability or sensitive finding.",
    href: `${REPOSITORY_URL}/security/policy`,
    icon: ShieldCheck,
    label: "Report a security issue",
  },
] as const;

export const SupportPage = () => {
  const [question, setQuestion] = useState("");

  const submitQuestion = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    window.location.assign(createSupportIssueUrl(question));
  };

  return (
    <SiteShell active="support">
      <main className="reading-main">
        <section className="reading-hero support-hero">
          <h1>How can we help?</h1>
          <p>
            Describe what you are trying to do. We will carry the question into a public GitHub
            issue where it can be answered and tracked.
          </p>
        </section>

        <section aria-labelledby="ask-title" className="support-compose">
          <div>
            <h2 id="ask-title">Ask a question</h2>
            <p>
              Include the network, account type, and the step where you became stuck. Remove wallet
              addresses or transaction details you do not want to make public.
            </p>
          </div>
          <form onSubmit={submitQuestion}>
            <label htmlFor="support-question">What do you need help with?</label>
            <textarea
              id="support-question"
              maxLength={2_000}
              onChange={(event) => setQuestion(event.currentTarget.value)}
              placeholder="I am trying to…"
              required
              rows={7}
              value={question}
            />
            <div className="form-footer">
              <span>{question.length.toLocaleString()} / 2,000</span>
              <Button type="submit">
                Continue on GitHub
                <ArrowUpRight aria-hidden="true" />
              </Button>
            </div>
          </form>
        </section>

        <section aria-labelledby="routes-title" className="support-routes page-section">
          <h2 id="routes-title">Or go straight to the right place.</h2>
          <div>
            {supportRoutes.map(({ description, href, icon: Icon, label }) => (
              <a href={href} key={label} rel={href.startsWith("http") ? "noreferrer" : undefined}>
                <Icon aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <ArrowRight aria-hidden="true" />
              </a>
            ))}
          </div>
        </section>

        <aside className="secret-warning">
          <ShieldCheck aria-hidden="true" />
          <p>
            <strong>Keep secrets out of support requests.</strong> Bramble support will never need
            your recovery phrase, private key, password, viewing key, or raw signature material.
          </p>
        </aside>
      </main>
    </SiteShell>
  );
};
