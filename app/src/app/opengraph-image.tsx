import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { H, phaseChartPaths } from "@/components/waitlist/phaseChartGeometry";

/**
 * Link preview card (Open Graph and Twitter): the landing's headline on white beside the phase chart,
 * drawn large. Previews shrink the card to about 500px wide, so it carries no small text, and the
 * bottom-left corner stays empty: X lays the page title over it.
 *
 * Satori reads neither woff2 nor variable fonts, so src/fonts/og holds static TTF instances of the
 * site's own Outfit (800) and Plus Jakarta Sans (500, 700), cut from the variable files in src/fonts.
 */
export const alt = "Plinto: token launches with a floor in tokenized stocks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#14142b";
const INK_2 = "#4a4a66";
const FLOOR = "#16735c";
const MINT = "#7fe0bf";
const MIDNIGHT = "#0b0b24";

/** The chart box, and the scale from PhaseChart's 150px-tall drawing to it (strokes scale too). */
const CHART = { w: 450, h: 470 };
const SCALE = 2.3;
const CHART_TOP = 110;

async function font(file: string) {
  return readFile(join(process.cwd(), "src/fonts/og", file));
}

export default async function OpengraphImage() {
  const [outfit, jakarta500, jakarta700] = await Promise.all([
    font("outfit-800.ttf"),
    font("jakarta-500.ttf"),
    font("jakarta-700.ttf"),
  ]);
  const vw = CHART.w / SCALE;
  const p = phaseChartPaths(vw);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: "0 64px 0 72px",
          fontFamily: "Jakarta",
          color: INK,
        }}
      >
        {/* Left: brand, headline, one line of copy; nothing at the bottom, where X puts its title. */}
        <div style={{ display: "flex", flexDirection: "column", width: 620, height: CHART.h, paddingTop: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* The plain site mark (LogoMark, tone "plain"). */}
            <svg width="60" height="60" viewBox="0 0 64 64">
              <path d="M14 50.5h36v-8l-36 4.5z" fill={FLOOR} stroke={FLOOR} strokeWidth="4" strokeLinejoin="round" />
              <path
                d="M13.7 37.7L25.1 27.4l8 5.7L50.3 17.1"
                fill="none"
                stroke={MIDNIGHT}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div style={{ fontFamily: "Outfit", fontSize: 48, letterSpacing: -1.4 }}>Plinto</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", fontFamily: "Outfit", fontSize: 88, lineHeight: 1, letterSpacing: -3.5, marginTop: 48 }}>
            <span style={{ whiteSpace: "nowrap" }}>Token launches</span>
            <span style={{ display: "flex", marginTop: 8 }}>
              with a&nbsp;
              {/* FloorWord: floor green on a soft mint bar. */}
              <span style={{ display: "flex", position: "relative", color: FLOOR }}>
                <span
                  style={{
                    position: "absolute",
                    left: 3,
                    right: 3,
                    bottom: -5,
                    height: 13,
                    borderRadius: 999,
                    background: "#bfeedb",
                  }}
                />
                <span style={{ position: "relative" }}>floor</span>
              </span>
            </span>
          </div>

          <div style={{ marginTop: 36, fontSize: 32, lineHeight: 1.35, color: INK_2, fontWeight: 500, maxWidth: 540 }}>
            Part of every raise is locked in tokenized stocks.
          </div>
        </div>

        {/* Right: the phase chart, large */}
        <div
          style={{
            display: "flex",
            position: "relative",
            width: CHART.w,
            height: CHART.h,
            borderRadius: 36,
            overflow: "hidden",
            background: MIDNIGHT,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 32,
              left: 32,
              right: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 26,
              fontWeight: 700,
              color: "#ffffff",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 30, height: 5, borderRadius: 3, background: "#ffffff" }} />
              Price
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 12, color: MINT }}>
              <span style={{ width: 30, height: 7, borderRadius: 4, background: MINT }} />
              Floor
            </span>
          </div>
          <svg
            width={CHART.w}
            height={H * SCALE}
            viewBox={`0 0 ${vw} ${H}`}
            style={{ position: "absolute", left: 0, top: CHART_TOP + (CHART.h - CHART_TOP - H * SCALE) }}
          >
            <defs>
              <linearGradient id="priceFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#8b7cf6" stopOpacity="0.32" />
                <stop offset="1" stopColor="#8b7cf6" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="floorFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={MINT} stopOpacity="0.38" />
                <stop offset="1" stopColor={MINT} stopOpacity="0.08" />
              </linearGradient>
            </defs>
            <line x1={p.splitX} y1="0" x2={p.splitX} y2={H} stroke="#3a3a66" strokeWidth="1.2" strokeDasharray="3 4" />
            <path d={p.floorArea} fill="url(#floorFade)" />
            <path d={p.floorLine} stroke={MINT} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            <path d={p.priceArea} fill="url(#priceFade)" />
            <path
              d={p.presaleLine}
              stroke="#ffffff"
              strokeOpacity="0.55"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="1 6"
              fill="none"
            />
            <path d={p.priceLine} stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {p.touches.map((t) => (
              <circle key={t.x} cx={t.x} cy={t.y} r="4.5" fill={MIDNIGHT} stroke={MINT} strokeWidth="2.5" />
            ))}
          </svg>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Outfit", data: outfit, weight: 800, style: "normal" },
        { name: "Jakarta", data: jakarta500, weight: 500, style: "normal" },
        { name: "Jakarta", data: jakarta700, weight: 700, style: "normal" },
      ],
    },
  );
}
