import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { PHASES } from "@/components/waitlist/LaunchRunsCard";
import { H, phaseChartPaths } from "@/components/waitlist/phaseChartGeometry";

/**
 * Link preview card (Open Graph and Twitter): the landing's first screen on white, with the headline
 * on the left and the "How a launch runs" card on the right. Generated at build time.
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
const CLOUD = "#f7f6fe";
const LINE = "#efecf9";

/** Phase chips and values, as in LaunchRunsCard. */
const CHIP = [
  { bg: "#dcebff", fg: "#1f5fae", value: INK },
  { bg: "#fbf1b8", fg: "#6e5400", value: FLOOR },
  { bg: "#d8f5ea", fg: FLOOR, value: INK },
];

const CHART_W = 412;

async function font(file: string) {
  return readFile(join(process.cwd(), "src/fonts/og", file));
}

export default async function OpengraphImage() {
  const [outfit, jakarta500, jakarta700] = await Promise.all([
    font("outfit-800.ttf"),
    font("jakarta-500.ttf"),
    font("jakarta-700.ttf"),
  ]);
  const p = phaseChartPaths(CHART_W);

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
        {/* Left: brand, headline, subtitle, network */}
        <div style={{ display: "flex", flexDirection: "column", width: 560, height: 516, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* The plain site mark (LogoMark, tone "plain"). */}
            <svg width="52" height="52" viewBox="0 0 64 64">
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
            <div style={{ fontFamily: "Outfit", fontSize: 40, letterSpacing: -1.2 }}>Plinto</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                fontFamily: "Outfit",
                fontSize: 82,
                lineHeight: 1,
                letterSpacing: -3.3,
              }}
            >
              <span>Token launches</span>
              <span style={{ display: "flex", marginTop: 6 }}>
                with a&nbsp;
                {/* FloorWord: floor green on a soft mint bar. */}
                <span style={{ display: "flex", position: "relative", color: FLOOR }}>
                  <span
                    style={{
                      position: "absolute",
                      left: 3,
                      right: 3,
                      bottom: -4,
                      height: 11,
                      borderRadius: 999,
                      background: "#bfeedb",
                    }}
                  />
                  <span style={{ position: "relative" }}>floor</span>
                </span>
              </span>
            </div>
            <div style={{ marginTop: 30, fontSize: 25, lineHeight: 1.5, color: INK_2, maxWidth: 520 }}>
              Part of every raise is locked in tokenized stocks. Holders redeem against it once the market opens.
            </div>
          </div>

          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                height: 44,
                padding: "0 18px",
                borderRadius: 21,
                background: MIDNIGHT,
                color: "#ffffff",
                fontSize: 17,
                fontWeight: 700,
              }}
            >
              <div style={{ width: 9, height: 9, borderRadius: 9, background: MINT }} />
              Solana · Meteora DBC
            </div>
          </div>
        </div>

        {/* Right: How a launch runs */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 444,
            padding: 16,
            borderRadius: 28,
            border: `1px solid ${LINE}`,
            background: "#ffffff",
            boxShadow: "0 14px 34px -22px rgba(60, 40, 150, 0.3)",
          }}
        >
          <div style={{ fontFamily: "Outfit", fontSize: 26, letterSpacing: -0.4, padding: "6px 8px 14px" }}>
            How a launch runs
          </div>

          <div style={{ display: "flex", position: "relative", width: CHART_W, height: H, borderRadius: 18, overflow: "hidden", background: MIDNIGHT }}>
            <svg width={CHART_W} height={H} viewBox={`0 0 ${CHART_W} ${H}`}>
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
              <line x1={p.splitX} y1="30" x2={p.splitX} y2={H} stroke="#3a3a66" strokeWidth="1.5" strokeDasharray="3 4" />
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
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 16,
                right: 16,
                display: "flex",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1.4,
                color: "#b9b8d6",
              }}
            >
              <span style={{ width: p.splitX - 6 }}>PRESALE</span>
              <span>MARKET</span>
              {/* Legend, as in PhaseChart. */}
              <span style={{ display: "flex", alignItems: "center", gap: 14, marginLeft: "auto", letterSpacing: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 16, height: 2.5, borderRadius: 2, background: "#ffffff" }} />
                  Price
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 16, height: 3.5, borderRadius: 2, background: MINT }} />
                  Floor
                </span>
              </span>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {PHASES.map((phase, i) => (
              <div
                key={phase.n}
                style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 12, borderRadius: 18, background: CLOUD }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 36,
                    height: 26,
                    borderRadius: 9,
                    background: CHIP[i].bg,
                    color: CHIP[i].fg,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {phase.n}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", flex: 1, fontSize: 14, lineHeight: 1.5, color: INK_2 }}>
                  <span style={{ fontWeight: 700, color: INK }}>{phase.title}&nbsp;</span>
                  {phase.body}
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: CHIP[i].value, paddingTop: 1 }}>{phase.value}</div>
              </div>
            ))}
          </div>
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
