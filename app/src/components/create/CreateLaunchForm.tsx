"use client";

import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  METEORA_KEEPER_MIN_THRESHOLD_USD,
  QUOTE_ALLOWLIST,
  uiToRaw,
  type CurvePreset,
  type LaunchInput,
} from "@stockfloor/sdk";
import {
  DEFAULT_EXIT_FEE_BPS,
  IS_LOCAL_RPC,
  THRESHOLD_POLICY,
  VAULT_SHARE_DEFAULT,
  VAULT_SHARE_MAX,
  VAULT_SHARE_MIN,
  type ThresholdPolicy,
} from "@/lib/config";
import { imageUrlFromUri } from "@/lib/chain/metadata";
import type { LaunchResume } from "@/lib/data/types";
import { useCluster, useData, useQuoteMarkets, useRefreshChainData, useTokenBalance, useTxFlow } from "@/lib/data/context";
import { parseUiNumber } from "@/lib/estimates";
import { formatPercent, formatTokenAmount, formatUsd } from "@/lib/format";
import { quoteRawToUsd } from "@/lib/metrics";
import {
  formatUsdWhole,
  launchPriceError,
  parseThresholdUsd,
  previewLaunchInput,
  validateLaunchForm,
  type LaunchFormValues,
} from "@/lib/launchForm";
import { useAttestation } from "@/lib/attestation";
import { useActionGate } from "@/components/token/useActionGate";
import { AttestationCheckbox } from "@/components/ui/AttestationCheckbox";
import { VolatilityTag } from "@/components/ui/QuoteChip";
import { IconTile } from "@/components/ui/Tiles";
import { CheckIcon, InfoIcon, LockIcon, PercentIcon, PieIcon, SwapIcon, WalletIcon } from "@/components/ui/icons";
import { WalletButton } from "@/components/layout/WalletButton";
import { PageColumns } from "@/components/layout/PageColumns";
import { TxProgress } from "@/components/ui/TxProgress";
import { LaunchPreviewPanel, MOBILE_GUTTER } from "./LaunchPreviewPanel";

const PRESETS: { id: CurvePreset; title: string; body: string }[] = [
  {
    id: "gentle",
    title: "Gentle",
    body: "The last price is 1.2× the first. IPO-style price discovery that rewards early buyers a little.",
  },
  {
    id: "flat",
    title: "Flat",
    body: "The last price is 1.01× the first. Everyone in the presale pays nearly the same price.",
  },
];

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "done"; ok: boolean; message: string; mint?: string; resume?: LaunchResume };

/** The quote coin at any size: a midnight disc with a small white ticker that never touches the rim. */
function Coin({ symbol, size = 24 }: { symbol: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-midnight font-extrabold tracking-[-0.02em] text-white"
      style={{ width: size, height: size, fontSize: size >= 32 ? 11 : 8 }}
    >
      {symbol.replace(/x$/, "").slice(0, 3).toUpperCase()}
    </span>
  );
}

/** Threshold as typed in the custom field, grouped ("1,000"). */
function thresholdInput(amount: number): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Soft Cloud input from the Pastel tiles: rounded 20px, lifts to white with a violet ring on focus. */
const FIELD =
  "block w-full rounded-soft border border-transparent bg-cloud px-4 py-3.5 text-base text-ink placeholder:text-[#8a8aa3] transition-colors hover:border-line-strong focus:border-transparent focus:bg-surface focus:outline-2 focus:outline-offset-0 focus:outline-violet aria-[invalid=true]:border-risk aria-[invalid=true]:bg-risk-wash disabled:cursor-not-allowed disabled:opacity-60";

/** Range input drawn as the vault/liquidity split bar: 12px track, 22px white thumb with a floor ring. */
const SPLIT_RANGE = [
  "block h-3 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed",
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet",
  "[&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-floor [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(20,20,43,0.22)]",
  "[&::-moz-range-thumb]:h-[18px] [&::-moz-range-thumb]:w-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-floor [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-[0_2px_8px_rgba(20,20,43,0.22)]",
  "[&::-moz-range-track]:bg-transparent",
].join(" ");

/** A selectable tile around a visually hidden radio: Cloud at rest, white with a violet ring when chosen. */
function choiceTile(checked: boolean) {
  return `relative flex cursor-pointer items-center gap-3 rounded-soft p-3.5 transition-[background-color,box-shadow] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-violet has-[:disabled]:cursor-not-allowed ${
    checked ? "bg-surface shadow-[0_0_0_2px_var(--color-violet),var(--shadow-tile)]" : "bg-cloud hover:bg-lilac"
  }`;
}

/** The round tick in a choice tile's corner. */
function ChoiceMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full transition-colors ${
        checked ? "bg-violet text-white" : "border-2 border-line-strong bg-surface"
      }`}
    >
      {checked ? <CheckIcon size={14} strokeWidth={2.4} /> : null}
    </span>
  );
}

/** One numbered step of the form: a white card holding a fieldset, its legend as the card header. */
function StepCard({
  step,
  title,
  note,
  hint,
  disabled,
  children,
}: {
  step: number;
  title: string;
  note?: string;
  hint?: ReactNode;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="card p-5 sm:p-7">
      <fieldset disabled={disabled} className="min-w-0">
        {/* Floated so the legend lays out as a normal block inside the card. */}
        <legend className="float-left w-full">
          <span className="flex items-center gap-3.5">
            <IconTile tone="violet" size={40}>
              {step}
            </IconTile>
            <span className="heading text-ink">
              {title}
              {note ? <span className="ml-2 font-sans text-sm font-medium tracking-normal text-ink-3">{note}</span> : null}
            </span>
          </span>
        </legend>
        <div className="clear-left pt-4">
          {hint ? <p className="field-hint mb-5 max-w-[560px] leading-relaxed">{hint}</p> : null}
          {children}
        </div>
      </fieldset>
    </div>
  );
}

export function CreateLaunchForm({
  intro,
  thresholdPolicy: policy = THRESHOLD_POLICY,
}: {
  intro?: ReactNode;
  /** Threshold rules; defaults to the build's policy (`NEXT_PUBLIC_DEMO_THRESHOLDS`). Tests pass the demo one. */
  thresholdPolicy?: ThresholdPolicy;
} = {}) {
  const formId = useId();
  const wallet = useWallet();
  const { actions, dataSource } = useData();
  const markets = useQuoteMarkets();
  const cluster = useCluster();
  const gate = useActionGate({ requireAttestation: false });
  const { attested } = useAttestation();
  const refresh = useRefreshChainData();
  const [flow, dispatch] = useTxFlow();
  const [firstBuy, setFirstBuy] = useState("");

  const [values, setValues] = useState<LaunchFormValues>({
    name: "",
    symbol: "",
    metadataUri: "",
    quoteSymbol: QUOTE_ALLOWLIST[0]?.symbol ?? "SPYx",
    preset: "gentle",
    vaultSharePct: VAULT_SHARE_DEFAULT,
    thresholdUsd: thresholdInput(policy.defaultUsd),
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  const errors = validateLaunchForm(values, policy);
  // Only a threshold that passes the range check is sent to the SDK; otherwise the preview keeps the default.
  const thresholdUsd = errors.thresholdUsd ? null : parseThresholdUsd(values.thresholdUsd);
  const market = markets.data?.find((m) => m.asset.symbol === values.quoteSymbol) ?? null;
  const quoteBalance = useTokenBalance(market?.asset.mint ?? null);

  let firstBuyRaw: bigint | null = null;
  let firstBuyError: string | null = null;
  if (firstBuy.trim() !== "" && market) {
    try {
      if (parseUiNumber(firstBuy) === null) throw new Error();
      firstBuyRaw = uiToRaw(firstBuy.trim().replace(/,/g, ""), market.asset.decimals, market.multiplier);
    } catch {
      firstBuyError = "Enter a valid amount.";
    }
    if (firstBuyRaw !== null && wallet.connected && quoteBalance.data !== undefined && firstBuyRaw > quoteBalance.data) {
      firstBuyError = `Amount exceeds your ${market.asset.symbol} balance.`;
    }
  }
  // A launch prices its threshold with the live quote price; outside a local cluster stale or reference prices are refused.
  const priceError = market ? launchPriceError(dataSource.kind, market.priceSource, IS_LOCAL_RPC) : null;

  const input: LaunchInput | null =
    market && thresholdUsd !== null
      ? {
          name: values.name.trim(),
          symbol: values.symbol.trim().toUpperCase(),
          // Written into the immutable Metaplex metadata: a metadata JSON document, or a bare image URL.
          uri: values.metadataUri.trim(),
          quote: market.asset,
          quotePriceUsd: market.priceUsd,
          quoteMultiplier: market.multiplier,
          preset: values.preset,
          vaultSharePct: values.vaultSharePct,
          thresholdUsd,
          exitFeeBps: DEFAULT_EXIT_FEE_BPS,
        }
      : null;

  // The preview also runs the port of DBC's create_config validation, so a threshold the chain
  // would reject shows up here instead of at signing time.
  const { preview, error: previewError } = useMemo(() => {
    if (!market || thresholdUsd === null) return { preview: null, error: null };
    return previewLaunchInput({
      name: "Preview",
      symbol: "PREVIEW",
      uri: "",
      quote: market.asset,
      quotePriceUsd: market.priceUsd,
      quoteMultiplier: market.multiplier,
      preset: values.preset,
      vaultSharePct: values.vaultSharePct,
      thresholdUsd,
      exitFeeBps: DEFAULT_EXIT_FEE_BPS,
    });
  }, [market, values.preset, values.vaultSharePct, thresholdUsd]);

  function update<K extends keyof LaunchFormValues>(key: K, value: LaunchFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    if (submit.status === "done" && !submit.ok) {
      setSubmit({ status: "idle" });
      dispatch({ type: "reset" });
    }
  }

  // The first buy is a curve trade in the quote xStock: the same eligibility attestation as token pages applies.
  const firstBuyNeedsAttestation = firstBuyRaw !== null && firstBuyRaw > 0n;
  const attestationMissing = firstBuyNeedsAttestation && !attested;

  const hasErrors = Object.keys(errors).length > 0;
  /**
   * The parameters are frozen while a launch is in flight, after it succeeded, and while a retry is
   * pending: a retry re-sends the transactions built from the original input, so an edited form
   * would promise a floor and a threshold that are not the ones being launched.
   */
  const locked = submit.status === "submitting" || (submit.status === "done" && (submit.ok || !!submit.resume));
  const canSubmit =
    !hasErrors &&
    input !== null &&
    !previewError &&
    gate.ready &&
    !firstBuyError &&
    !priceError &&
    !attestationMissing &&
    !locked;

  async function run(resume?: LaunchResume) {
    if (!input) return;
    setSubmit({ status: "submitting" });
    if (!resume) dispatch({ type: "reset" });
    const result = await actions.createLaunch(input, wallet, {
      dispatch,
      firstBuyQuoteRaw: firstBuyRaw ?? undefined,
      resume,
    });
    if (result.ok) refresh();
    setSubmit({
      status: "done",
      ok: result.ok,
      message: result.ok ? `Launch created: ${result.value.mint}` : result.error,
      mint: result.ok ? result.value.mint : undefined,
      resume: result.ok ? undefined : result.resume,
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched({ name: true, symbol: true, metadataUri: true });
    if (hasErrors || !input) return;
    await run();
  }

  function startOver() {
    setSubmit({ status: "idle" });
    dispatch({ type: "reset" });
  }

  const fieldError = (key: keyof LaunchFormValues) => (touched[key] ? errors[key] : undefined);

  const quoteSymbol = market?.asset.symbol ?? "the quote asset";
  // Where the thumb sits on the track, in percent of its width.
  const sharePos = ((values.vaultSharePct - VAULT_SHARE_MIN) / (VAULT_SHARE_MAX - VAULT_SHARE_MIN)) * 100;
  const firstBuyUsd = market && firstBuyRaw !== null && !firstBuyError ? quoteRawToUsd(firstBuyRaw, market) : 0;

  const form = (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-describedby={`${formId}-intro`}>
      <p id={`${formId}-intro`} className="sr-only">
        Configure the token, its quote asset, curve, vault share and graduation threshold. The preview updates as you
        type.
      </p>

      <StepCard step={1} title="Token" disabled={locked}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <div className="space-y-2">
            <label htmlFor={`${formId}-name`} className="field-label">
              Name
            </label>
            <input
              id={`${formId}-name`}
              className={FIELD}
              value={values.name}
              maxLength={32}
              placeholder="Harbor Coffee Co-op"
              autoComplete="off"
              aria-invalid={fieldError("name") ? true : undefined}
              aria-describedby={fieldError("name") ? `${formId}-name-error` : undefined}
              onChange={(e) => update("name", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            />
            {fieldError("name") ? (
              <p id={`${formId}-name-error`} className="text-[13px] font-medium text-risk">
                {fieldError("name")}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor={`${formId}-symbol`} className="field-label">
              Symbol
            </label>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-ink-3">
                $
              </span>
              <input
                id={`${formId}-symbol`}
                className={`${FIELD} pl-8 font-bold uppercase tracking-wide`}
                value={values.symbol}
                maxLength={10}
                placeholder="HRBR"
                autoComplete="off"
                aria-invalid={fieldError("symbol") ? true : undefined}
                aria-describedby={fieldError("symbol") ? `${formId}-symbol-error` : undefined}
                onChange={(e) => update("symbol", e.target.value.toUpperCase())}
                onBlur={() => setTouched((t) => ({ ...t, symbol: true }))}
              />
            </div>
            {fieldError("symbol") ? (
              <p id={`${formId}-symbol-error`} className="text-[13px] font-medium text-risk">
                {fieldError("symbol")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 space-y-2">
          <label htmlFor={`${formId}-uri`} className="field-label">
            Token metadata JSON URL <span className="font-medium text-ink-3">(optional)</span>
          </label>
          <input
            id={`${formId}-uri`}
            className={FIELD}
            type="url"
            inputMode="url"
            value={values.metadataUri}
            placeholder="https://example.com/token.json"
            autoComplete="off"
            aria-invalid={fieldError("metadataUri") ? true : undefined}
            aria-describedby={`${formId}-uri-hint`}
            onChange={(e) => update("metadataUri", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, metadataUri: true }))}
          />
          <p
            id={`${formId}-uri-hint`}
            className={fieldError("metadataUri") ? "text-[13px] font-medium text-risk" : "field-hint leading-relaxed"}
          >
            {fieldError("metadataUri") ??
              "This is what wallets and explorers read: an https link to a JSON document with name, symbol, description and image (a square image). A bare image URL also works, but then they show your token without a description. The URI is immutable after launch."}
          </p>
        </div>
      </StepCard>

      <StepCard
        step={2}
        title="Quote asset"
        disabled={locked}
        hint="Buyers pay in this asset (on mainnet the app can route USDC or SOL through Jupiter). The floor is held in it. Index and gold trackers are calm; single stocks move more, and the floor moves with them in USD."
      >
        <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Quote asset">
          {QUOTE_ALLOWLIST.map((asset) => {
            const m = markets.data?.find((x) => x.asset.mint === asset.mint);
            const checked = values.quoteSymbol === asset.symbol;
            return (
              <label key={asset.mint} className={choiceTile(checked)}>
                <input
                  type="radio"
                  name={`${formId}-quote`}
                  value={asset.symbol}
                  checked={checked}
                  onChange={() => update("quoteSymbol", asset.symbol)}
                  className="sr-only"
                />
                <Coin symbol={asset.symbol} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-ink">{asset.symbol}</span>
                    <span className="tnum ml-auto text-[13px] font-bold text-ink-2">{m ? formatUsd(m.priceUsd) : "…"}</span>
                    <ChoiceMark checked={checked} />
                  </span>
                  <span className="mt-1.5 flex items-start gap-1.5">
                    <span className="shrink-0">
                      <VolatilityTag volatility={asset.volatility} />
                    </span>
                    <span className="line-clamp-2 text-xs leading-snug text-ink-3">{asset.underlying}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </StepCard>

      <StepCard step={3} title="Curve and vault" disabled={locked}>
        <p className="field-label">Curve preset</p>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2" role="radiogroup" aria-label="Curve preset">
          {PRESETS.map((preset) => {
            const checked = values.preset === preset.id;
            return (
              <label key={preset.id} className={`${choiceTile(checked)} items-start`}>
                <input
                  type="radio"
                  name={`${formId}-preset`}
                  value={preset.id}
                  checked={checked}
                  onChange={() => update("preset", preset.id)}
                  className="sr-only"
                />
                <PresetGlyph preset={preset.id} active={checked} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold text-ink">{preset.title}</span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-ink-2">{preset.body}</span>
                </span>
                <ChoiceMark checked={checked} />
              </label>
            );
          })}
        </div>

        <div className="mt-7 flex items-end justify-between gap-3">
          <label htmlFor={`${formId}-share`} className="field-label">
            Share of the raise locked in the floor vault
          </label>
          <output
            htmlFor={`${formId}-share`}
            className="tnum shrink-0 rounded-full bg-floor-soft px-3 py-1 text-lg font-extrabold leading-tight text-floor"
          >
            {values.vaultSharePct}%
          </output>
        </div>
        <div className="mt-3 rounded-soft bg-cloud px-4 pb-3.5 pt-5">
          {/* The track is the split itself: mint for the vault left of the thumb, sky for the pool right of it. */}
          <input
            id={`${formId}-share`}
            type="range"
            min={VAULT_SHARE_MIN}
            max={VAULT_SHARE_MAX}
            step={1}
            value={values.vaultSharePct}
            onChange={(e) => update("vaultSharePct", Number(e.target.value))}
            className={SPLIT_RANGE}
            style={{
              background: `linear-gradient(to right, var(--color-floor-bar) 0 ${sharePos}%, var(--color-presale-ring) ${sharePos}% 100%)`,
            }}
            aria-valuetext={`${values.vaultSharePct}% to the vault, ${100 - values.vaultSharePct}% to market liquidity`}
          />
          <div className="tnum mt-3 flex justify-between gap-3 text-xs font-bold">
            <span className="text-floor">{values.vaultSharePct}% vault</span>
            <span className="text-right text-presale">{100 - values.vaultSharePct}% DAMM v2 liquidity</span>
          </div>
          <div aria-hidden className="tnum mt-1 flex justify-between text-[11px] font-semibold text-ink-3">
            <span>{VAULT_SHARE_MIN}% min</span>
            <span>{VAULT_SHARE_MAX}% max</span>
          </div>
        </div>
        <p className="field-hint mt-3 leading-relaxed">
          A higher share means a higher floor and a thinner market. The share is taken as the DBC partner migration fee
          and harvested into the vault at graduation.
        </p>
      </StepCard>

      <StepCard
        step={4}
        title="Graduation threshold"
        note="advanced"
        disabled={locked}
        hint={
          <>
            How much the presale must raise before the curve completes, the vault is funded and the floor goes live. The
            default is {formatUsdWhole(policy.defaultUsd)}
            {policy.demo ? "; this demo build allows small thresholds for cheap launches with the same mechanics" : ""}.
            Fixed in USD at launch and converted to {quoteSymbol} at the price shown above.
          </>
        }
      >
        <div className="segmented" role="group" aria-label="Graduation threshold quick picks">
          {policy.presetsUsd.map((amount) => {
            const selected = thresholdUsd === amount;
            return (
              <button
                key={amount}
                type="button"
                aria-pressed={selected}
                onClick={() => update("thresholdUsd", thresholdInput(amount))}
                className="tnum flex-col !gap-0 px-1 leading-tight"
              >
                {formatUsdWhole(amount)}
                {amount === policy.defaultUsd ? (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3"> default</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="mt-5 space-y-2">
          <label htmlFor={`${formId}-threshold`} className="field-label">
            Custom amount in USD
          </label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-ink-3">
              $
            </span>
            <input
              id={`${formId}-threshold`}
              className={`${FIELD} tnum pl-8 font-bold`}
              inputMode="decimal"
              autoComplete="off"
              placeholder={thresholdInput(policy.defaultUsd)}
              value={values.thresholdUsd}
              aria-invalid={errors.thresholdUsd || previewError ? true : undefined}
              aria-describedby={`${formId}-threshold-hint`}
              onChange={(e) => update("thresholdUsd", e.target.value)}
              onBlur={() => {
                if (thresholdUsd === null) return;
                const grouped = thresholdInput(thresholdUsd);
                if (grouped !== values.thresholdUsd) update("thresholdUsd", grouped);
              }}
            />
          </div>
          <p
            id={`${formId}-threshold-hint`}
            className={errors.thresholdUsd || previewError ? "text-[13px] font-medium text-risk" : "field-hint"}
          >
            {errors.thresholdUsd ??
              previewError ??
              `Between ${formatUsdWhole(policy.minUsd)} and ${formatUsdWhole(policy.maxUsd)}. Checked against the same rules the chain applies to the pool config.`}
          </p>
        </div>
        {thresholdUsd !== null && thresholdUsd < METEORA_KEEPER_MIN_THRESHOLD_USD ? (
          <div className="tile-cream mt-4 flex gap-3 p-4 text-[13px] leading-relaxed text-ink-2">
            <InfoIcon size={18} className="mt-px shrink-0 text-graduating" />
            <p>
              Below about {formatUsdWhole(METEORA_KEEPER_MIN_THRESHOLD_USD)} Meteora&apos;s keeper does not migrate the
              pool for you. Migration and the vault harvest then wait for the permissionless crank on the token page —
              anyone can run it, and until they do there is no floor.
            </p>
          </div>
        ) : null}
      </StepCard>

      <StepCard step={5} title="Your first buy" note="optional" disabled={locked}>
        <div className="field-soft">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${formId}-first-buy`} className="block text-[13px] text-ink-3">
                Amount in {quoteSymbol}
              </label>
              <input
                id={`${formId}-first-buy`}
                className="tnum mt-1 w-full bg-transparent text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink placeholder:text-[#b4b3c9] focus:outline-none disabled:cursor-not-allowed aria-[invalid=true]:text-risk"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                value={firstBuy}
                aria-invalid={firstBuyError ? true : undefined}
                onChange={(e) => setFirstBuy(e.target.value)}
              />
              <p className="tnum mt-0.5 text-[13px] text-ink-3">
                ≈ {formatUsd(firstBuyUsd)}
              </p>
            </div>
            {market ? (
              <span className="chip shrink-0 pl-[5px]" aria-hidden>
                <Coin symbol={market.asset.symbol} />
                <b>{market.asset.symbol}</b>
              </span>
            ) : null}
          </div>
        </div>
        <p className={`mt-2.5 ${firstBuyError ? "text-[13px] font-medium text-risk" : "field-hint leading-relaxed"}`}>
          {firstBuyError ??
            `Bought on the curve in the same transaction that creates the pool, so nobody can buy before you.${
              wallet.connected && market && quoteBalance.data !== undefined
                ? ` Balance: ${formatTokenAmount(quoteBalance.data, market.asset.decimals, { multiplier: market.multiplier, maxFractionDigits: 8 })} ${market.asset.symbol}.`
                : ""
            }`}
        </p>
        {firstBuyNeedsAttestation ? <AttestationCheckbox className="mt-4" /> : null}
      </StepCard>

      <StepCard step={6} title="Fixed terms" disabled={locked}>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <FixedTerm icon={<PercentIcon />} tone="risk" label="Exit fee">
            {formatPercent(DEFAULT_EXIT_FEE_BPS / 10_000)}, stays in vault
          </FixedTerm>
          <FixedTerm icon={<SwapIcon />} tone="presale" label="Curve trading fee">
            1%
          </FixedTerm>
          <FixedTerm icon={<PieIcon />} tone="graduating" label="Team allocation">
            None
          </FixedTerm>
          <FixedTerm icon={<LockIcon />} tone="floor" label="Your share of the raise">
            None
          </FixedTerm>
        </dl>
        <p className="mt-5 flex gap-3 rounded-soft bg-cloud p-4 text-[13px] leading-relaxed text-ink-2">
          <LockIcon size={18} className="mt-px shrink-0 text-violet" />
          <span>
            This is not a fundraising round. The raise splits between the floor vault and permanently locked liquidity,
            and you receive none of it: your only income is 30% of the curve trading fee. Launch here for a token you
            intend to keep working on, not for launch revenue.
          </span>
        </p>

        <div className="mt-6 space-y-3 border-t border-line pt-6">
          {/* Disabled reads as a quiet Cloud button, never a faded green one. */}
          <button
            id="launch-submit"
            type="submit"
            className={`btn btn-lg w-full text-[17px] ${
              canSubmit || submit.status === "submitting"
                ? "btn-primary"
                : "bg-cloud text-ink-3 shadow-none ring-1 ring-inset ring-line disabled:opacity-100"
            }`}
            disabled={!canSubmit}
            aria-busy={submit.status === "submitting"}
          >
            {!canSubmit && !locked ? <LockIcon size={18} /> : null}
            {submit.status === "submitting" ? "Launching…" : "Launch token"}
          </button>
          {!wallet.connected ? (
            <div className="flex flex-col items-center gap-3 rounded-soft bg-cloud px-4 py-4 text-center sm:flex-row sm:text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-icon bg-violet-soft text-violet" aria-hidden>
                <WalletIcon size={20} />
              </span>
              <p className="field-hint flex-1 leading-relaxed">
                Connect a wallet to launch. You pay network fees and rent only (about 0.05 SOL).
              </p>
              <div className="shrink-0">
                <WalletButton variant="bar" menuPlacement="up-start" />
              </div>
            </div>
          ) : !gate.ready ? (
            <p className="field-hint text-center">{gate.reason}</p>
          ) : attestationMissing ? (
            <p className="field-hint text-center">Confirm your eligibility under “Your first buy”, or remove the first buy.</p>
          ) : null}
          {priceError ? <p className="text-center text-[13px] font-medium text-risk">{priceError}</p> : null}
          {dataSource.kind === "chain" && cluster.data?.kind === "local-fork" ? (
            <p className="field-hint text-center">Local fork: the launch is created on your Surfpool copy of mainnet, never on mainnet.</p>
          ) : null}
        </div>
      </StepCard>

      {/* Outside the frozen fieldsets: the retry and "Open the token page" actions must stay usable. */}
      <TxProgress
        flow={flow}
        title="Launch transactions"
        actions={
          submit.status === "done" ? (
            submit.ok && submit.mint ? (
              <Link href={`/t/${submit.mint}`} className="btn btn-floor">
                Open the token page
              </Link>
            ) : (
              <>
                {submit.resume ? (
                  <button type="button" className="btn btn-primary" onClick={() => void run(submit.resume)}>
                    Retry from the failed step
                  </button>
                ) : null}
                <button type="button" className="btn btn-secondary" onClick={startOver}>
                  {submit.resume ? "Start over" : "Dismiss"}
                </button>
              </>
            )
          ) : null
        }
      />
      {submit.status === "done" && flow.status === "idle" ? (
        <p
          role="status"
          className={`rounded-soft px-4 py-3 text-sm ${
            submit.ok ? "bg-floor-wash font-semibold text-floor-strong" : "bg-surface text-ink-2 shadow-tile"
          }`}
        >
          {submit.message}
        </p>
      ) : null}
    </form>
  );

  // Below lg both columns are `display: contents`, so the intro, the preview's floor card, the form and
  // the rest of the preview become siblings ordered 1–5: the floor reacts right under the title on a phone.
  return (
    <PageColumns
      mainClassName="max-lg:contents"
      railClassName="max-lg:contents"
      main={
        <>
          <div className={`max-lg:order-1 max-lg:mt-4 ${MOBILE_GUTTER}`}>{intro}</div>
          <div className={`max-lg:order-3 max-lg:mt-5 ${MOBILE_GUTTER}`}>{form}</div>
        </>
      }
      rail={
        <LaunchPreviewPanel
            preview={preview}
            error={errors.thresholdUsd ?? previewError ?? (markets.isError ? "Could not load quote prices." : null)}
            loading={markets.isPending}
            market={market}
            preset={values.preset}
            vaultSharePct={values.vaultSharePct}
            thresholdUsd={thresholdUsd}
            name={values.name}
            symbol={values.symbol}
            // The avatar can only show a direct image; a metadata JSON document is read after launch.
            imageUrl={errors.metadataUri ? null : imageUrlFromUri(values.metadataUri.trim())}
          />
      }
    />
  );
}

/** A fixed-term row in the vault-row style: tinted icon tile, grey label, bold value. */
function FixedTerm({
  icon,
  tone,
  label,
  children,
}: {
  icon: ReactNode;
  tone: "risk" | "presale" | "graduating" | "floor";
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <IconTile tone={tone} size={44}>
        {icon}
      </IconTile>
      <div className="min-w-0">
        <dt className="text-[13px] text-ink-3">{label}</dt>
        <dd className="mt-0.5 text-base font-extrabold text-ink">{children}</dd>
      </div>
    </div>
  );
}

/** Small drawing of the preset's price path: a gentle rise, or a nearly flat line. */
function PresetGlyph({ preset, active }: { preset: CurvePreset; active: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-icon ${
        active ? "bg-violet-soft text-violet" : "bg-surface text-ink-3"
      }`}
    >
      <svg width="26" height="20" viewBox="0 0 26 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M2 18h22" strokeWidth="1.4" opacity=".45" />
        {preset === "gentle" ? <path d="M3 14C10 13.5 16 11 23 5" /> : <path d="M3 10.5C10 10.3 16 10 23 9.6" />}
      </svg>
    </span>
  );
}
