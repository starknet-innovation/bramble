import { type CSSProperties, useEffect, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD
 *
 * Read top-to-bottom. Each value is ms after a scroll or click trigger.
 *
 *   0ms   previous screen exits 8px toward its place in the journey
 * 260ms   next screen settles from 12px into the persistent wallet frame
 * ───────────────────────────────────────────────────────── */
const TIMING = {
  screenSettle: 260,
} as const;

const SCREENS = {
  collectibles: {
    alt: "Bramble Home with the Collectibles tab selected",
    src: "/wallet-collectibles.webp",
  },
  deploy: {
    alt: "Bramble account deployment review",
    src: "/wallet-deploy.webp",
  },
  home: {
    alt: "Bramble Home showing a Starknet account, portfolio balance, actions, assets, and navigation",
    src: "/wallet-home.webp",
  },
  receive: {
    alt: "Bramble Receive screen with a Starknet wallet card and copy actions",
    src: "/wallet-receive.webp",
  },
  review: {
    alt: "Bramble Send review showing the asset, recipient, fee, and approval action",
    src: "/wallet-review.webp",
  },
  success: {
    alt: "Bramble confirmation screen for a completed Starknet transfer",
    src: "/wallet-success.webp",
  },
  swap: {
    alt: "Bramble Swap screen showing the sell and buy assets",
    src: "/wallet-swap.webp",
  },
  tokens: {
    alt: "Bramble token management showing tracked, not-shown, and likely-spam assets",
    src: "/wallet-tokens.webp",
  },
} as const;

type WalletScreen = keyof typeof SCREENS;

const SCREEN_DEPTH: Record<WalletScreen, number> = {
  collectibles: 1,
  deploy: 2,
  home: 0,
  receive: 1,
  review: 1,
  success: 3,
  swap: 1,
  tokens: 1,
};

const isWalletScreen = (value: string | undefined): value is WalletScreen =>
  value !== undefined && Object.hasOwn(SCREENS, value);

const SCREEN_IDS = Object.keys(SCREENS).filter(isWalletScreen);

export const WalletPreview = () => {
  const [screen, setScreen] = useState<WalletScreen>("home");

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>("[data-wallet-screen]");
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        const nearest = [...visible].sort(
          (left, right) =>
            Math.abs(left.getBoundingClientRect().top - window.innerHeight * 0.35) -
            Math.abs(right.getBoundingClientRect().top - window.innerHeight * 0.35),
        )[0] as HTMLElement | undefined;
        const next = nearest?.dataset["walletScreen"];
        if (isWalletScreen(next)) setScreen(next);
      },
      { rootMargin: "-24% 0px -56% 0px" },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const motionStyle = {
    "--wallet-screen-duration": `${TIMING.screenSettle}ms`,
  } as CSSProperties;

  return (
    <figure className="wallet-preview" style={motionStyle}>
      {SCREEN_IDS.map((id) => {
        const details = SCREENS[id];
        const active = id === screen;
        const position = active
          ? "active"
          : SCREEN_DEPTH[id] < SCREEN_DEPTH[screen]
            ? "before"
            : "after";
        return (
          <img
            alt={active ? details.alt : ""}
            aria-hidden={!active}
            className={`wallet-screen${active ? " is-active" : ""}`}
            data-position={position}
            decoding="async"
            height="1520"
            key={id}
            loading={id === "home" ? "eager" : "lazy"}
            src={details.src}
            width="800"
          />
        );
      })}

      {screen === "success" ? (
        <span aria-hidden="true" className="wallet-success-mark">
          <svg viewBox="0 0 56 56">
            <title>Transaction successful</title>
            <circle className="wallet-success-ring" cx="28" cy="28" r="25" />
            <path className="wallet-success-check" d="M18 29.5l7 7 14-15" />
          </svg>
        </span>
      ) : null}

      {screen === "home" ? (
        <fieldset aria-label="Try the wallet preview" className="wallet-hotspots">
          <button
            aria-label="Preview Send review"
            className="wallet-hotspot wallet-hotspot--send"
            onClick={() => setScreen("review")}
            type="button"
          />
          <button
            aria-label="Preview Swap"
            className="wallet-hotspot wallet-hotspot--swap"
            onClick={() => setScreen("swap")}
            type="button"
          />
          <button
            aria-label="Preview Receive"
            className="wallet-hotspot wallet-hotspot--receive"
            onClick={() => setScreen("receive")}
            type="button"
          />
          <a
            aria-label="Open Starkscan"
            className="wallet-hotspot wallet-hotspot--explorer"
            href="https://starkscan.co/"
            rel="noreferrer"
            target="_blank"
          >
            <span className="sr-only">Open Starkscan</span>
          </a>
          <button
            aria-label="Preview Collectibles"
            className="wallet-hotspot wallet-hotspot--collectibles"
            onClick={() => setScreen("collectibles")}
            type="button"
          />
          <button
            aria-label="Preview token management"
            className="wallet-hotspot wallet-hotspot--tokens"
            onClick={() => setScreen("tokens")}
            type="button"
          />
        </fieldset>
      ) : (
        <button
          aria-label="Return preview to Bramble Home"
          className={`wallet-hotspot ${screen === "collectibles" ? "wallet-hotspot--tokens-tab" : "wallet-hotspot--back"}`}
          onClick={() => setScreen("home")}
          type="button"
        />
      )}

      <figcaption aria-live="polite" className="sr-only">
        {SCREENS[screen].alt}
      </figcaption>
    </figure>
  );
};
