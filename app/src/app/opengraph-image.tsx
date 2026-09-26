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
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "#1c1c3d", display: "flex", alignItems: "flex-end", padding: 10 }}>
            <div style={{ width: 44, height: 8, borderRadius: 3, background: "#7fe0bf" }} />
          </div>
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
