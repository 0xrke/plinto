"use client";

import { Chapter, type ChapterStep } from "../scroll/Chapter";
import { BigCoinStill, FloorVsCrypto, FloorVsCryptoStill } from "./FloorVsCrypto";
import { StockPicker } from "./StockPicker";
import { WHY_EYEBROW, WHY_ID, WHY_STEPS } from "./whyStocks.copy";

const STEPS: readonly ChapterStep[] = [
  { body: <p>{WHY_STEPS[0]}</p>, still: <FloorVsCryptoStill step={0} /> },
  { body: <p>{WHY_STEPS[1]}</p>, still: <FloorVsCryptoStill step={1} /> },
  {
    body: (
      <>
        <p>{WHY_STEPS[2]}</p>
        <StockPicker />
      </>
    ),
    still: <BigCoinStill />,
  },
];

/**
 * 02 Why stocks: a crypto floor sinks with the token, a stock floor follows stocks (which fall too),
 * then the reader picks the floor asset or scrolls on with SPYx.
 */
export function WhyStocks() {
  return <Chapter id={WHY_ID} numeral="02" eyebrow={WHY_EYEBROW} steps={STEPS} stage={<FloorVsCrypto />} />;
}
