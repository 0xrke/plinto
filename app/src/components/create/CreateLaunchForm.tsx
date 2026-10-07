"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  METEORA_KEEPER_MIN_THRESHOLD_USD,
  QUOTE_ALLOWLIST,
  RESERVED_NAME_MESSAGE,
  uiToRaw,
  type CurvePreset,
  type LaunchInput,
} from "@stockfloor/sdk";
import {
  CREATOR_GRADUATION_BONUS_PCT,
  DEFAULT_EXIT_FEE_BPS,
  IS_LOCAL_RPC,
  LP_FEE_SPLIT_PCT,
  PLATFORM_GRADUATION_FEE_PCT,
  THRESHOLD_POLICY,
  VAULT_SHARE_DEFAULT,
  VAULT_SHARE_MAX,
  VAULT_SHARE_MIN,
  poolSharePct,
  type ThresholdPolicy,
} from "@/lib/config";
import { imageUrlFromUri } from "@/lib/chain/metadata";
import type { LaunchResume } from "@/lib/data/types";
import { useCluster, useData, useQuoteMarkets, useRefreshChainData, useTokenBalance, useTxFlow } from "@/lib/data/context";
import { parseUiNumber } from "@/lib/estimates";
import { formatTokenAmount, formatUsd } from "@/lib/format";
import { quoteRawToUsd } from "@/lib/metrics";
import {
  formatUsdWhole,
  launchPriceError,
  parseThresholdUsd,
  previewLaunchInput,
  validateLaunchForm,
  type LaunchFormValues,
} from "@/lib/launchForm";
import { uploadTokenMetadata } from "@/lib/upload/client";
import { IMAGE_ACCEPT, imageFileError } from "@/lib/upload/image";
import { MAX_DESCRIPTION_CHARS } from "@/lib/upload/metadata";
import { useAttestation } from "@/lib/attestation";
import { useActionGate } from "@/components/token/useActionGate";
import { AttestationCheckbox } from "@/components/ui/AttestationCheckbox";
import { Details } from "@/components/ui/Details";
import { VolatilityTag } from "@/components/ui/QuoteChip";
import { CheckIcon, InfoIcon, LockIcon } from "@/components/ui/icons";
import { WalletButton } from "@/components/layout/WalletButton";
import { PageColumns } from "@/components/layout/PageColumns";
import { TxProgress } from "@/components/ui/TxProgress";
import { LaunchPreviewPanel, MOBILE_GUTTER } from "./LaunchPreviewPanel";

/** Flat first: it is the default (docs/DECISIONS.md, founder decisions of 2026-09-25). */
const PRESETS: { id: CurvePreset; title: string; body: string }[] = [
  { id: "flat", title: "Flat", body: "Price ×1.01 over the presale" },
  { id: "gentle", title: "Gentle", body: "Price ×1.2 over the presale" },
];

type SubmitState =
  | { status: "idle" }
  | { status: "submitting"; stage: "upload" | "launch" }
  | { status: "done"; ok: boolean; message: string; mint?: string; resume?: LaunchResume };

/** The picked token image and its preview URL (an object URL; null where the platform has none, as in jsdom). */
interface PickedImage {
  file: File;
  previewUrl: string | null;
}

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
  return `relative flex cursor-pointer items-center gap-3 rounded-soft p-3 transition-[background-color,box-shadow] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-violet has-[:disabled]:cursor-not-allowed ${
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

/** One section of the single form card: a fieldset with a small legend, split from the one above by a rule. */
function Section({
  title,
  disabled,
  first = false,
  children,
}: {
  title: string;
  disabled: boolean;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset disabled={disabled} className={`min-w-0 ${first ? "" : "border-t border-line pt-6"}`}>
      {/* Floated so the legend lays out as a normal block. */}
      <legend className="float-left w-full text-[15px] font-bold text-ink">{title}</legend>
      <div className="clear-left pt-3">{children}</div>
    </fieldset>
  );
}

/** A label, an input and its error or hint, the way every text field of the form is laid out. */
function TextField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] font-medium text-risk">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Key of everything an upload depends on, so a retry reuses the stored metadata instead of uploading again. */
function uploadKey(values: LaunchFormValues, image: PickedImage | null): string {
  return JSON.stringify([
    values.name.trim(),
    values.symbol.trim().toUpperCase(),
    values.description.trim(),
    values.website.trim(),
    values.twitter.trim(),
    values.telegram.trim(),
    image ? [image.file.name, image.file.size, image.file.lastModified, image.file.type] : null,
  ]);
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
    description: "",
    website: "",
    twitter: "",
    telegram: "",
    metadataUri: "",
    quoteSymbol: QUOTE_ALLOWLIST[0]?.symbol ?? "SPYx",
    preset: "flat",
    vaultSharePct: VAULT_SHARE_DEFAULT,
    thresholdUsd: thresholdInput(policy.defaultUsd),
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [image, setImage] = useState<PickedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The server has no upload storage (501): the own-URL field is the way to give the token an image. */
  const [uploadUnavailable, setUploadUnavailable] = useState(false);
  const uploaded = useRef<{ key: string; uri: string } | null>(null);

  // The object URL lives as long as the picked file.
  useEffect(() => {
    const url = image?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [image]);

  const errors = validateLaunchForm(values, policy);
  // Only a threshold that passes the range check is sent to the SDK; otherwise the preview keeps the default.
  const thresholdUsd = errors.thresholdUsd ? null : parseThresholdUsd(values.thresholdUsd);
  const market = markets.data?.find((m) => m.asset.symbol === values.quoteSymbol) ?? null;
  const quoteBalance = useTokenBalance(market?.asset.mint ?? null);
  const ownUri = values.metadataUri.trim();

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

  /** The launch input without its URI: that is the uploaded metadata (or the own URL), set in `run`. */
  const input: Omit<LaunchInput, "uri"> | null =
    market && thresholdUsd !== null
      ? {
          name: values.name.trim(),
          symbol: values.symbol.trim().toUpperCase(),
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

  function clearFailure() {
    if (submit.status === "done" && !submit.ok) {
      setSubmit({ status: "idle" });
      dispatch({ type: "reset" });
    }
  }

  function update<K extends keyof LaunchFormValues>(key: K, value: LaunchFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    clearFailure();
  }

  function pickImage(file: File | undefined) {
    if (!file) return;
    const error = imageFileError(file);
    setImageError(error);
    clearFailure();
    if (error) return;
    const previewUrl = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
    setImage({ file, previewUrl });
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

  /**
   * The token URI: the own URL when one is given; otherwise the uploaded metadata JSON (image,
   * description, links), uploaded once per set of values; empty when there is nothing to describe.
   */
  async function tokenUri(): Promise<{ ok: true; uri: string } | { ok: false; error: string }> {
    if (ownUri) return { ok: true, uri: ownUri };
    const description = values.description.trim();
    const links = { website: values.website.trim(), twitter: values.twitter.trim(), telegram: values.telegram.trim() };
    if (!image && !description && !links.website && !links.twitter && !links.telegram) return { ok: true, uri: "" };
    const key = uploadKey(values, image);
    if (uploaded.current?.key === key) return { ok: true, uri: uploaded.current.uri };
    setSubmit({ status: "submitting", stage: "upload" });
    const result = await uploadTokenMetadata({
      name: values.name.trim(),
      symbol: values.symbol.trim().toUpperCase(),
      description,
      links,
      image: image?.file ?? null,
    });
    if (!result.ok) {
      if (result.notConfigured) setUploadUnavailable(true);
      return { ok: false, error: result.error };
    }
    uploaded.current = { key, uri: result.uri };
    return { ok: true, uri: result.uri };
  }

  async function run(resume?: LaunchResume) {
    if (!input) return;
    if (!resume) dispatch({ type: "reset" });
    const uri = await tokenUri();
    if (!uri.ok) {
      setSubmit({ status: "done", ok: false, message: uri.error });
      return;
    }
    setSubmit({ status: "submitting", stage: "launch" });
    const result = await actions.createLaunch({ ...input, uri: uri.uri }, wallet, {
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
    setTouched({ name: true, symbol: true, metadataUri: true, description: true, website: true, twitter: true, telegram: true });
    if (hasErrors || !input || !canSubmit) return;
    await run();
  }

  function startOver() {
    setSubmit({ status: "idle" });
    dispatch({ type: "reset" });
  }

  // Reserved names show at once, while typing; the other field errors after the field is left.
  const fieldError = (key: keyof LaunchFormValues) =>
    touched[key] || errors[key] === RESERVED_NAME_MESSAGE ? errors[key] : undefined;
  // The reserved-name message is shown once under the name and ticker row, whichever field (or both) hit it.
  const reservedName = fieldError("name") === RESERVED_NAME_MESSAGE;
  const reservedSymbol = fieldError("symbol") === RESERVED_NAME_MESSAGE;
  const ownError = (key: "name" | "symbol") => (fieldError(key) === RESERVED_NAME_MESSAGE ? undefined : fieldError(key));
  const describedBy = (key: "name" | "symbol", reserved: boolean) =>
    reserved ? `${formId}-reserved` : ownError(key) ? `${formId}-${key}-error` : undefined;

  const quoteSymbol = market?.asset.symbol ?? "the quote asset";
  // Where the thumb sits on the track, in percent of its width.
  const sharePos = ((values.vaultSharePct - VAULT_SHARE_MIN) / (VAULT_SHARE_MAX - VAULT_SHARE_MIN)) * 100;
  const poolPct = poolSharePct(values.vaultSharePct);
  const firstBuyUsd = market && firstBuyRaw !== null && !firstBuyError ? quoteRawToUsd(firstBuyRaw, market) : 0;
  const balanceText =
    wallet.connected && market && quoteBalance.data !== undefined
      ? ` · Balance ${formatTokenAmount(quoteBalance.data, market.asset.decimals, { multiplier: market.multiplier, maxFractionDigits: 8 })} ${market.asset.symbol}`
      : "";
  // The avatar shows the picked image, or the own URL when it is a direct image (a JSON document is read after launch).
  const avatarUrl = ownUri ? (errors.metadataUri ? null : imageUrlFromUri(ownUri)) : (image?.previewUrl ?? null);

  const linkField = (kind: "website" | "twitter" | "telegram", label: string, placeholder: string) => (
    <TextField id={`${formId}-${kind}`} label={label} error={fieldError(kind)}>
      <input
        id={`${formId}-${kind}`}
        className={FIELD}
        type="url"
        inputMode="url"
        value={values[kind]}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={fieldError(kind) ? true : undefined}
        aria-describedby={fieldError(kind) ? `${formId}-${kind}-error` : undefined}
        onChange={(e) => update(kind, e.target.value)}
        onBlur={() => setTouched((t) => ({ ...t, [kind]: true }))}
      />
    </TextField>
  );

  const form = (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-describedby={`${formId}-intro`}>
      <p id={`${formId}-intro`} className="sr-only">
        Configure the token, its quote asset, vault share and raise target. The preview updates as you type.
      </p>

      <div className="card space-y-6 p-5 sm:p-7">
        <Section title="Token" disabled={locked} first>
          <div className="grid gap-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            {/* The drop zone: a label around a hidden file input, so a click, a tap or a drop all pick a file. */}
            <div>
              <label
                htmlFor={`${formId}-image`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!locked) pickImage(e.dataTransfer.files[0]);
                }}
                className={`relative flex aspect-square w-32 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-soft border-2 border-dashed text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-violet sm:w-full ${
                  dragging ? "border-violet bg-lilac" : imageError ? "border-risk bg-risk-wash" : "border-line-strong bg-cloud hover:bg-lilac"
                }`}
              >
                <input
                  id={`${formId}-image`}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  aria-label="Token image"
                  aria-describedby={`${formId}-image-hint`}
                  className="sr-only"
                  onChange={(e) => {
                    pickImage(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {image?.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
                  <img src={image.previewUrl} alt="Selected token image" className="absolute inset-0 h-full w-full object-cover" />
                ) : image ? (
                  <span className="px-2 text-xs font-semibold text-ink-2">{image.file.name}</span>
                ) : (
                  <>
                    <ImageGlyph />
                    <span className="text-[13px] font-semibold text-ink-2">Add image</span>
                  </>
                )}
              </label>
              <p
                id={`${formId}-image-hint`}
                className={`mt-2 text-xs ${imageError ? "font-medium text-risk" : "text-ink-3"}`}
              >
                {imageError ?? "Square · PNG, JPG, WebP, GIF · 1 MB"}
              </p>
              {image ? (
                <button
                  type="button"
                  className="mt-1 text-xs font-semibold text-violet hover:text-violet-hover"
                  onClick={() => setImage(null)}
                >
                  Remove image
                </button>
              ) : null}
            </div>

            <div className="min-w-0 space-y-4">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <TextField id={`${formId}-name`} label="Name" error={ownError("name")}>
                  <input
                    id={`${formId}-name`}
                    className={FIELD}
                    value={values.name}
                    maxLength={32}
                    placeholder="My Token"
                    autoComplete="off"
                    aria-invalid={fieldError("name") ? true : undefined}
                    aria-describedby={describedBy("name", reservedName)}
                    onChange={(e) => update("name", e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  />
                </TextField>
                <TextField id={`${formId}-symbol`} label="Ticker" error={ownError("symbol")}>
                  <div className="relative">
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-ink-3"
                    >
                      $
                    </span>
                    <input
                      id={`${formId}-symbol`}
                      className={`${FIELD} pl-8 font-bold uppercase tracking-wide`}
                      value={values.symbol}
                      maxLength={10}
                      placeholder="TICKER"
                      autoComplete="off"
                      aria-invalid={fieldError("symbol") ? true : undefined}
                      aria-describedby={describedBy("symbol", reservedSymbol)}
                      onChange={(e) => update("symbol", e.target.value.toUpperCase())}
                      onBlur={() => setTouched((t) => ({ ...t, symbol: true }))}
                    />
                  </div>
                </TextField>
              </div>
              {reservedName || reservedSymbol ? (
                <p id={`${formId}-reserved`} className="-mt-2 text-[13px] font-medium text-risk">
                  {RESERVED_NAME_MESSAGE}
                </p>
              ) : null}
              <TextField
                id={`${formId}-description`}
                label={
                  <>
                    Description <span className="font-medium text-ink-3">(optional)</span>
                  </>
                }
                error={fieldError("description")}
              >
                <textarea
                  id={`${formId}-description`}
                  className={`${FIELD} min-h-[88px] resize-y`}
                  value={values.description}
                  maxLength={MAX_DESCRIPTION_CHARS}
                  rows={3}
                  placeholder="What is this token about?"
                  aria-invalid={fieldError("description") ? true : undefined}
                  onChange={(e) => update("description", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, description: true }))}
                />
              </TextField>
            </div>
          </div>

          <Details
            summary="Add links"
            className="mt-3"
            forceOpen={Boolean(errors.website || errors.twitter || errors.telegram)}
          >
            <div className="grid gap-4 pb-1 pt-2 sm:grid-cols-3">
              {linkField("website", "Website", "https://…")}
              {linkField("twitter", "X", "https://x.com/…")}
              {linkField("telegram", "Telegram", "https://t.me/…")}
            </div>
          </Details>

          <Details
            summary="Advanced: use my own metadata URL"
            forceOpen={uploadUnavailable || Boolean(errors.metadataUri)}
          >
            <div className="pb-1 pt-2">
              <TextField
                id={`${formId}-uri`}
                label="Metadata or image URL"
                error={fieldError("metadataUri")}
                hint={
                  uploadUnavailable
                    ? "Image upload is not available here. Link to a token JSON or image instead."
                    : "Link to a token JSON or image. Replaces the image, description and links above. Can't be changed after launch."
                }
              >
                <input
                  id={`${formId}-uri`}
                  className={FIELD}
                  type="url"
                  inputMode="url"
                  value={values.metadataUri}
                  placeholder="https://example.com/token.json"
                  autoComplete="off"
                  aria-invalid={fieldError("metadataUri") ? true : undefined}
                  aria-describedby={fieldError("metadataUri") ? `${formId}-uri-error` : `${formId}-uri-hint`}
                  onChange={(e) => update("metadataUri", e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, metadataUri: true }))}
                />
              </TextField>
            </div>
          </Details>
        </Section>

        <Section title="Pay in" disabled={locked}>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Quote asset">
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
                  <Coin symbol={asset.symbol} size={32} />
                  <span className="text-[15px] font-bold text-ink">{asset.symbol}</span>
                  <VolatilityTag volatility={asset.volatility} />
                  <span className="tnum ml-auto text-[13px] font-bold text-ink-2">{m ? formatUsd(m.priceUsd) : "…"}</span>
                  <ChoiceMark checked={checked} />
                </label>
              );
            })}
          </div>
        </Section>

        <Section title="Floor" disabled={locked}>
          {/* The value shows once, in the legend under the track. */}
          <label htmlFor={`${formId}-share`} className="field-label">
            Floor share of the raise
          </label>
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
              aria-valuetext={`${values.vaultSharePct}% to the floor vault, ${poolPct}% to locked pool liquidity, ${PLATFORM_GRADUATION_FEE_PCT}% to the platform, ${CREATOR_GRADUATION_BONUS_PCT}% to the creator`}
            />
            <div className="tnum mt-3 flex justify-between gap-3 text-xs font-bold">
              <span className="text-floor">{values.vaultSharePct}% floor</span>
              <span className="text-right text-presale">
                {poolPct}% liquidity · {PLATFORM_GRADUATION_FEE_PCT + CREATOR_GRADUATION_BONUS_PCT}% fees
              </span>
            </div>
          </div>
          <p className="field-hint mt-2">Higher floor, thinner market.</p>
        </Section>

        <fieldset disabled={locked} className="min-w-0 border-t border-line pt-4">
          <Details summary="Advanced" forceOpen={Boolean(errors.thresholdUsd || previewError)}>
            <div className="space-y-6 pb-1 pt-3">
              <div>
                <p className="field-label">Raise target</p>
                <div className="segmented mt-2.5" role="group" aria-label="Graduation threshold quick picks">
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
                <div className="mt-4 space-y-2">
                  <label htmlFor={`${formId}-threshold`} className="field-label">
                    Custom amount in USD
                  </label>
                  <div className="relative">
                    <span
                      aria-hidden
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-ink-3"
                    >
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
                    {errors.thresholdUsd ?? previewError ?? `${formatUsdWhole(policy.minUsd)}–${formatUsdWhole(policy.maxUsd)}`}
                  </p>
                </div>
                {thresholdUsd !== null && thresholdUsd < METEORA_KEEPER_MIN_THRESHOLD_USD ? (
                  <p className="tile-cream mt-3 flex gap-2.5 p-3.5 text-[13px] text-ink-2">
                    <InfoIcon size={18} className="mt-px shrink-0 text-graduating" />
                    Below ~{formatUsdWhole(METEORA_KEEPER_MIN_THRESHOLD_USD)} migration needs a manual crank on the token
                    page.
                  </p>
                ) : null}
              </div>

              <div>
                <p className="field-label">Curve</p>
                <div className="mt-2.5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Curve preset">
                  {PRESETS.map((preset) => {
                    const checked = values.preset === preset.id;
                    return (
                      <label key={preset.id} className={choiceTile(checked)}>
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
                          <span className="block text-[13px] text-ink-2">{preset.body}</span>
                        </span>
                        <ChoiceMark checked={checked} />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </Details>
        </fieldset>

        <Section title="First buy (optional)" disabled={locked}>
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
                  {balanceText}
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
          <p className={`mt-2.5 ${firstBuyError ? "text-[13px] font-medium text-risk" : "field-hint"}`}>
            {firstBuyError ?? "Bought in the launch transaction, before anyone else."}
          </p>
          {firstBuyNeedsAttestation ? <AttestationCheckbox className="mt-4" /> : null}
        </Section>

        <div className="space-y-3 border-t border-line pt-6">
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
            {submit.status === "submitting"
              ? submit.stage === "upload"
                ? "Uploading image…"
                : "Launching…"
              : "Launch a token"}
          </button>
          <p className="field-hint text-center">
            You earn {CREATOR_GRADUATION_BONUS_PCT}% of the raise at graduation + {LP_FEE_SPLIT_PCT.creator}% of pool
            fees. No team allocation.
          </p>
          {!wallet.connected ? (
            <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-3">
              <WalletButton variant="bar" menuPlacement="up-start" />
              <span className="field-hint">≈ 0.05 SOL network fees</span>
            </div>
          ) : !gate.ready ? (
            <p className="field-hint text-center">{gate.reason}</p>
          ) : attestationMissing ? (
            <p className="field-hint text-center">Confirm eligibility under “First buy”, or remove the first buy.</p>
          ) : null}
          {priceError ? <p className="text-center text-[13px] font-medium text-risk">{priceError}</p> : null}
          {dataSource.kind === "chain" && cluster.data?.kind === "local-fork" ? (
            <p className="field-hint text-center">Local fork — nothing goes to mainnet.</p>
          ) : null}
        </div>
      </div>

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
          vaultSharePct={values.vaultSharePct}
          thresholdUsd={thresholdUsd}
          name={values.name}
          symbol={values.symbol}
          imageUrl={avatarUrl}
          exitFeeBps={DEFAULT_EXIT_FEE_BPS}
        />
      }
    />
  );
}

/** A picture frame with a plus: the empty drop zone. */
function ImageGlyph() {
  return (
    <svg aria-hidden width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-violet">
      <rect x="3" y="4" width="14" height="14" rx="3" />
      <path d="m3 15 4-4 4 4 2-2 4 4" />
      <path d="M20 3v6M17 6h6" />
    </svg>
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
