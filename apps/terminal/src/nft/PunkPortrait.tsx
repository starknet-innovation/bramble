import type { CSSProperties, ReactNode } from "react";
import { punkImageUrl } from "./punk-contract";

export type PunkPortraitProps = {
  readonly id: number;
  readonly size?: "card" | "hero" | "mini";
};

/**
 * Pixel-faithful Punk preview loaded from the official asset endpoint. The
 * neutral fallback remains visible if the remote image cannot be reached.
 */
export const PunkPortrait = ({ id, size = "card" }: PunkPortraitProps): ReactNode => (
  <span
    className={`punk-portrait punk-portrait--${size}`}
    style={{ "--punk-seed": id % 6 } as CSSProperties}
  >
    <span className="punk-portrait__fallback" aria-hidden="true">
      {String(id).padStart(4, "0")}
    </span>
    <img
      alt={`CryptoPunk catalog artwork #${id}`}
      decoding="async"
      draggable={false}
      loading={size === "hero" ? "eager" : "lazy"}
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
      src={punkImageUrl(id)}
    />
  </span>
);
