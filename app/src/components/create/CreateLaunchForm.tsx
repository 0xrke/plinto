"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  METEORA_KEEPER_MIN_THRESHOLD_USD,
  MIN_THRESHOLD_USD,
  QUOTE_ALLOWLIST,
  uiToRaw,
  type CurvePreset,
  type LaunchInput,
} from "@stockfloor/sdk";
import {
  DEFAULT_EXIT_FEE_BPS,
  DEFAULT_THRESHOLD_USD,
  IS_LOCAL_RPC,
  THRESHOLD_MAX_USD,
  THRESHOLD_PRESETS_USD,
  VAULT_SHARE_DEFAULT,
  VAULT_SHARE_MAX,
  VAULT_SHARE_MIN,
} from "@/lib/config";
import type { LaunchResume } from "@/lib/data/types";
import { useCluster, useData, useQuoteMarkets, useRefreshChainData, useTokenBalance, useTxFlow } from "@/lib/data/context";
import { parseUiNumber } from "@/lib/estimates";
import { formatPercent, formatTokenAmount, formatUsd } from "@/lib/format";
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
import { TxProgress } from "@/components/ui/TxProgress";
import { LaunchPreviewPanel } from "./LaunchPreviewPanel";

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

export function CreateLaunchForm() {
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
    imageUrl: "",
    quoteSymbol: QUOTE_ALLOWLIST[0]?.symbol ?? "SPYx",
    preset: "gentle",
    vaultSharePct: VAULT_SHARE_DEFAULT,
    thresholdUsd: String(DEFAULT_THRESHOLD_USD),
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  const errors = validateLaunchForm(values);
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
          // M4 replaces this with a metadata JSON URI that references the image.
          uri: values.imageUrl.trim(),
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
    setTouched({ name: true, symbol: true, imageUrl: true });
    if (hasErrors || !input) return;
    await run();
  }

  function startOver() {
    setSubmit({ status: "idle" });
    dispatch({ type: "reset" });
  }

  const fieldError = (key: keyof LaunchFormValues) => (touched[key] ? errors[key] : undefined);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
      <form onSubmit={onSubmit} noValidate className="card space-y-8 p-5 sm:p-6" aria-describedby={`${formId}-intro`}>
        <p id={`${formId}-intro`} className="sr-only">
          Configure the token, its quote asset, curve, vault share and graduation threshold. The preview updates as you
          type.
        </p>

        <fieldset className="space-y-4" disabled={locked}>
          <legend className="text-base font-semibold text-ink">Token</legend>
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-name`} className="field-label">
                Name
              </label>
              <input
                id={`${formId}-name`}
                className="input"
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
                <p id={`${formId}-name-error`} className="text-sm text-risk">
                  {fieldError("name")}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${formId}-symbol`} className="field-label">
                Symbol
              </label>
              <input
                id={`${formId}-symbol`}
                className="input uppercase"
                value={values.symbol}
                maxLength={10}
                placeholder="HRBR"
                autoComplete="off"
                aria-invalid={fieldError("symbol") ? true : undefined}
                aria-describedby={fieldError("symbol") ? `${formId}-symbol-error` : undefined}
                onChange={(e) => update("symbol", e.target.value.toUpperCase())}
                onBlur={() => setTouched((t) => ({ ...t, symbol: true }))}
              />
              {fieldError("symbol") ? (
                <p id={`${formId}-symbol-error`} className="text-sm text-risk">
                  {fieldError("symbol")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${formId}-image`} className="field-label">
              Image URL <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <input
              id={`${formId}-image`}
              className="input"
              type="url"
              inputMode="url"
              value={values.imageUrl}
              placeholder="https://example.com/logo.png"
              autoComplete="off"
              aria-invalid={fieldError("imageUrl") ? true : undefined}
              aria-describedby={`${formId}-image-hint`}
              onChange={(e) => update("imageUrl", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, imageUrl: true }))}
            />
            <p id={`${formId}-image-hint`} className={fieldError("imageUrl") ? "text-sm text-risk" : "field-hint"}>
              {fieldError("imageUrl") ?? "Square image, served over https. Token metadata is immutable after launch."}
            </p>
          </div>
        </fieldset>

        <fieldset className="space-y-3" disabled={locked}>
          <legend className="text-base font-semibold text-ink">Quote asset</legend>
          <p className="field-hint -mt-1">
            Buyers pay in this asset (on mainnet the app can route USDC or SOL through Jupiter). The floor is held in it.
            Index and gold trackers are calm; single stocks move more, and the floor moves with them in USD.
          </p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Quote asset">
            {QUOTE_ALLOWLIST.map((asset) => {
              const m = markets.data?.find((x) => x.asset.mint === asset.mint);
              const checked = values.quoteSymbol === asset.symbol;
              return (
                <label
                  key={asset.mint}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    checked ? "border-brand bg-brand-soft/60 ring-1 ring-brand" : "border-line hover:border-line-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${formId}-quote`}
                    value={asset.symbol}
                    checked={checked}
                    onChange={() => update("quoteSymbol", asset.symbol)}
                    className="mt-1 accent-brand"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{asset.symbol}</span>
                      <VolatilityTag volatility={asset.volatility} />
                    </span>
                    <span className="block truncate text-xs text-ink-3">{asset.underlying}</span>
                  </span>
                  <span className="tnum text-sm text-ink-2">{m ? formatUsd(m.priceUsd) : "…"}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-3" disabled={locked}>
          <legend className="text-base font-semibold text-ink">Curve preset</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Curve preset">
            {PRESETS.map((preset) => {
              const checked = values.preset === preset.id;
              return (
                <label
                  key={preset.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                    checked ? "border-brand bg-brand-soft/60 ring-1 ring-brand" : "border-line hover:border-line-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${formId}-preset`}
                    value={preset.id}
                    checked={checked}
                    onChange={() => update("preset", preset.id)}
                    className="mt-1 accent-brand"
                  />
                  <span>
                    <span className="block font-semibold text-ink">{preset.title}</span>
                    <span className="block text-sm text-ink-2">{preset.body}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="space-y-3" disabled={locked}>
          <legend className="text-base font-semibold text-ink">Vault share</legend>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={`${formId}-share`} className="field-label">
              Share of the raise locked in the floor vault
            </label>
            <output htmlFor={`${formId}-share`} className="tnum text-lg font-semibold text-floor-strong">
              {values.vaultSharePct}%
            </output>
          </div>
          <input
            id={`${formId}-share`}
            type="range"
            min={VAULT_SHARE_MIN}
            max={VAULT_SHARE_MAX}
            step={1}
            value={values.vaultSharePct}
            onChange={(e) => update("vaultSharePct", Number(e.target.value))}
            className="w-full"
            aria-valuetext={`${values.vaultSharePct}% to the vault, ${100 - values.vaultSharePct}% to market liquidity`}
          />
          <div className="flex justify-between text-xs text-ink-3">
            <span>{VAULT_SHARE_MIN}%</span>
            <span>
              {values.vaultSharePct}% vault · {100 - values.vaultSharePct}% DAMM v2 liquidity
            </span>
            <span>{VAULT_SHARE_MAX}%</span>
          </div>
          <p className="field-hint">
            A higher share means a higher floor and a thinner market. The share is taken as the DBC partner
            migration fee and harvested into the vault at graduation.
          </p>
        </fieldset>

        <fieldset className="space-y-3" disabled={locked}>
          <legend className="text-base font-semibold text-ink">
            Graduation threshold <span className="font-normal text-ink-3">(advanced)</span>
          </legend>
          <p className="field-hint -mt-1">
            How much the presale must raise before the curve completes, the vault is funded and the floor goes live.
            The default is {formatUsdWhole(DEFAULT_THRESHOLD_USD)}; a small threshold makes a cheap demo with the same
            mechanics. Fixed in USD at launch and converted to {market?.asset.symbol ?? "the quote asset"} at the price
            shown above.
          </p>
          <div className="flex flex-wrap gap-2">
            {THRESHOLD_PRESETS_USD.map((amount) => {
              const selected = thresholdUsd === amount;
              return (
                <button
                  key={amount}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => update("thresholdUsd", String(amount))}
                  className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${
                    selected ? "border-brand bg-brand-soft/60 text-ink ring-1 ring-brand" : "border-line text-ink-2 hover:border-line-strong"
                  }`}
                >
                  {formatUsdWhole(amount)}
                  {amount === DEFAULT_THRESHOLD_USD ? <span className="ml-1 font-normal text-ink-3">default</span> : null}
                </button>
              );
            })}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${formId}-threshold`} className="field-label">
              Custom amount in USD
            </label>
            <input
              id={`${formId}-threshold`}
              className="input tnum"
              inputMode="decimal"
              autoComplete="off"
              placeholder={String(DEFAULT_THRESHOLD_USD)}
              value={values.thresholdUsd}
              aria-invalid={errors.thresholdUsd || previewError ? true : undefined}
              aria-describedby={`${formId}-threshold-hint`}
              onChange={(e) => update("thresholdUsd", e.target.value)}
            />
            <p
              id={`${formId}-threshold-hint`}
              className={errors.thresholdUsd || previewError ? "text-sm text-risk" : "field-hint"}
            >
              {errors.thresholdUsd ??
                previewError ??
                `Between ${formatUsdWhole(MIN_THRESHOLD_USD)} and ${formatUsdWhole(THRESHOLD_MAX_USD)}. Checked against the same rules the chain applies to the pool config.`}
            </p>
          </div>
          {thresholdUsd !== null && thresholdUsd < METEORA_KEEPER_MIN_THRESHOLD_USD ? (
            <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">
              Below about {formatUsdWhole(METEORA_KEEPER_MIN_THRESHOLD_USD)} Meteora&apos;s keeper does not migrate the
              pool for you. Migration and the vault harvest then wait for the permissionless crank on the token page —
              anyone can run it, and until they do there is no floor.
            </p>
          ) : null}
        </fieldset>

        <fieldset className="space-y-3" disabled={locked}>
          <legend className="text-base font-semibold text-ink">
            Your first buy <span className="font-normal text-ink-3">(optional)</span>
          </legend>
          <div className="space-y-1.5">
            <label htmlFor={`${formId}-first-buy`} className="field-label">
              Amount in {market?.asset.symbol ?? "the quote asset"}
            </label>
            <input
              id={`${formId}-first-buy`}
              className="input tnum"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={firstBuy}
              aria-invalid={firstBuyError ? true : undefined}
              onChange={(e) => setFirstBuy(e.target.value)}
            />
            <p className={firstBuyError ? "text-sm text-risk" : "field-hint"}>
              {firstBuyError ??
                `Bought on the curve in the same transaction that creates the pool, so nobody can buy before you.${
                  wallet.connected && market && quoteBalance.data !== undefined
                    ? ` Balance: ${formatTokenAmount(quoteBalance.data, market.asset.decimals, { multiplier: market.multiplier, maxFractionDigits: 8 })} ${market.asset.symbol}.`
                    : ""
                }`}
            </p>
          </div>
          {firstBuyNeedsAttestation ? <AttestationCheckbox /> : null}
        </fieldset>

        <fieldset className="space-y-2" disabled={locked}>
          <legend className="text-base font-semibold text-ink">Fixed terms</legend>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3 rounded-lg bg-sunken px-3 py-2">
              <dt className="text-ink-2">Exit fee</dt>
              <dd className="font-semibold text-ink">{formatPercent(DEFAULT_EXIT_FEE_BPS / 10_000)}, stays in vault</dd>
            </div>
            <div className="flex justify-between gap-3 rounded-lg bg-sunken px-3 py-2">
              <dt className="text-ink-2">Curve trading fee</dt>
              <dd className="font-semibold text-ink">1%</dd>
            </div>
            <div className="flex justify-between gap-3 rounded-lg bg-sunken px-3 py-2">
              <dt className="text-ink-2">Team allocation</dt>
              <dd className="font-semibold text-ink">None</dd>
            </div>
          </dl>
        </fieldset>

        <div className="space-y-3 border-t border-line pt-6">
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={!canSubmit} aria-busy={submit.status === "submitting"}>
            {submit.status === "submitting" ? "Launching…" : "Launch token"}
          </button>
          {!wallet.connected ? (
            <p className="field-hint">Connect a wallet to launch. You pay network fees and rent only (about 0.05 SOL).</p>
          ) : !gate.ready ? (
            <p className="field-hint">{gate.reason}</p>
          ) : attestationMissing ? (
            <p className="field-hint">Confirm your eligibility under “Your first buy”, or remove the first buy.</p>
          ) : null}
          {priceError ? <p className="text-sm text-risk">{priceError}</p> : null}
          {dataSource.kind === "chain" && cluster.data?.kind === "local-fork" ? (
            <p className="field-hint">Local fork: the launch is created on your Surfpool copy of mainnet, never on mainnet.</p>
          ) : null}
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
              className={`rounded-lg px-3 py-2 text-sm ${
                submit.ok ? "bg-floor-soft text-floor-strong" : "bg-sunken text-ink-2"
              }`}
            >
              {submit.message}
            </p>
          ) : null}
        </div>
      </form>

      <div className="lg:sticky lg:top-20">
        <LaunchPreviewPanel
          preview={preview}
          error={
            errors.thresholdUsd ?? previewError ?? (markets.isError ? "Could not load quote prices." : null)
          }
          loading={markets.isPending}
          market={market}
          preset={values.preset}
          vaultSharePct={values.vaultSharePct}
          thresholdUsd={thresholdUsd}
          name={values.name}
          symbol={values.symbol}
          imageUrl={errors.imageUrl ? "" : values.imageUrl}
        />
      </div>
    </div>
  );
}
