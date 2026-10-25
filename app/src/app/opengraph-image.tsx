import { ImageResponse } from "next/og";

/**
 * Link preview card (Open Graph and Twitter). Without it the submitted URL shares as a blank card.
 * Generated at build time, so it needs no binary asset in the repository.
 */
export const alt = "Plinto — token launches with a redeemable floor in tokenized stocks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0b24",
          color: "#ffffff",
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* The site mark (LogoMark, tone "wash"), the same as the X avatar. */}
          <svg width="64" height="64" viewBox="0 0 64 64">
            <defs>
              <linearGradient id="w" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#fbdde8" />
                <stop offset="0.5" stopColor="#e8defb" />
                <stop offset="1" stopColor="#d9ebfb" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="18" fill="url(#w)" />
            <path d="M14 50.5h36v-8l-36 4.5z" fill="#16735c" stroke="#16735c" strokeWidth="4" strokeLinejoin="round" />
            <path d="M13.7 37.7L25.1 27.4l8 5.7L50.3 17.1" fill="none" stroke="#0b0b24" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -0.5 }}>Plinto</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 940 }}>
            Token launches with a floor in tokenized S&amp;P 500
          </div>
          <div style={{ fontSize: 30, color: "#c9c9df", maxWidth: 900, lineHeight: 1.35 }}>
            A share of every raise becomes a redeemable vault. The token can go up without limit; while the vault
            holds its stock token, it cannot fall to zero.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#a9a9c6" }}>
          Meteora Dynamic Bonding Curve · DAMM v2 · Solana
        </div>
      </div>
    ),
    size,
  );
}
