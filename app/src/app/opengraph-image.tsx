import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { H, phaseChartPaths } from "@/components/waitlist/phaseChartGeometry";

/**
 * Link preview card (Open Graph and Twitter), light, after the X banner: the headline on white, with
 * "floor" on its mint bar as on the page, over the phase chart drawn edge to edge along the bottom, its floor climbing steeper than on the page so it shows.
 * Previews shrink the card to about 500px wide, so it carries no small text.
 *
 * Satori reads neither woff2 nor variable fonts, so src/fonts/og holds static TTF instances of the
 * site's own Outfit (800) and Plus Jakarta Sans (700), cut from the variable files in src/fonts.
 */
export const alt = "Plinto: token launches with a floor in tokenized stocks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#14142b";
const FLOOR = "#16735c";
const MIDNIGHT = "#0b0b24";

/** PhaseChart's 150px-tall drawing, scaled up to the card's width (strokes scale with it). */
const SCALE = 2.4;
const VIEW_W = size.width / SCALE;

async function font(file: string) {
  return readFile(join(process.cwd(), "src/fonts/og", file));
}

export default async function OpengraphImage() {
  const [outfit, jakarta700] = await Promise.all([font("outfit-800.ttf"), font("jakarta-700.ttf")]);
  const p = phaseChartPaths(VIEW_W, { steep: true });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "#ffffff",
          fontFamily: "Jakarta",
          color: INK,
        }}
      >
        <svg
          width={size.width}
          height={H * SCALE}
          viewBox={`0 0 ${VIEW_W} ${H}`}
          style={{ position: "absolute", left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="floorFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#bfeedb" />
              <stop offset="1" stopColor="#e3f7ef" />
            </linearGradient>
          </defs>
          {/* Starts below the headline, clear of the bar under "floor". */}
          <line x1={p.splitX} y1="40" x2={p.splitX} y2={H} stroke="#c9c3ea" strokeWidth="0.8" strokeDasharray="3 3" />
          <path d={p.floorArea} fill="url(#floorFill)" />
          <path d={p.floorLine} stroke={FLOOR} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path
            d={p.presaleLine}
            stroke="#6b6b85"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="0.5 4.5"
            fill="none"
          />
          <path d={p.priceLine} stroke={MIDNIGHT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {p.touches.map((t) => (
            <circle key={t.x} cx={t.x} cy={t.y} r="3.6" fill={FLOOR} stroke="#ffffff" strokeWidth="1.2" />
          ))}
        </svg>

        {/* Brand and headline, top left; the chart runs underneath. */}
        <div style={{ position: "absolute", left: 72, top: 60, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            <div style={{ fontFamily: "Outfit", fontSize: 42, letterSpacing: -1.2 }}>Plinto</div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 34,
              fontFamily: "Outfit",
              fontSize: 92,
              lineHeight: 1,
              letterSpacing: -3.6,
            }}
          >
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
                    bottom: -6,
                    height: 13,
                    borderRadius: 999,
                    background: "#bfeedb",
                  }}
                />
                <span style={{ position: "relative" }}>floor</span>
              </span>
            </span>
          </div>
        </div>

        {/* Legend, top right */}
        <div
          style={{
            position: "absolute",
            right: 72,
            top: 72,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 14,
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 30, height: 5, borderRadius: 3, background: MIDNIGHT }} />
            Price
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 12, color: FLOOR }}>
            <span style={{ width: 30, height: 7, borderRadius: 4, background: FLOOR }} />
            Floor
          </span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Outfit", data: outfit, weight: 800, style: "normal" },
        { name: "Jakarta", data: jakarta700, weight: 700, style: "normal" },
      ],
    },
  );
}
