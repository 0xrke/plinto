"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { truncateAddress } from "@/lib/format";
import { WalletIcon } from "@/components/ui/icons";

const TRIGGER: Record<WalletButtonVariant, string> = {
  // Bottom of the desktop sidebar: a square icon chip while the sidebar is collapsed (lg), a
  // full-width chip with its label from xl.
  sidebar: "h-[52px] w-[52px] rounded-[18px] text-sm xl:w-full xl:px-4",
  // Chip in the mobile top bar.
  bar: "h-11 rounded-2xl px-4 text-sm",
};

const MENU: Record<WalletMenuPlacement, string> = {
  "down-end": "right-0 top-full mt-2",
  "up-start": "left-0 bottom-full mb-2",
};

export type WalletButtonVariant = "sidebar" | "bar";
export type WalletMenuPlacement = "down-end" | "up-start";

/**
 * Minimal wallet button on top of wallet-adapter-react. Wallets are discovered through
 * wallet-standard, so there is no bundled adapter list.
 */
export function WalletButton({
  variant = "bar",
  menuPlacement = "down-end",
}: {
  variant?: WalletButtonVariant;
  /** Where the menu opens: below and right-aligned (top bar) or above and left-aligned (sidebar bottom). */
  menuPlacement?: WalletMenuPlacement;
} = {}) {
  const { wallets, publicKey, connected, connecting, select, disconnect, wallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const detected = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  const address = publicKey?.toBase58() ?? null;
  const label = connecting ? (
    "Connecting…"
  ) : connected && address ? (
    truncateAddress(address)
  ) : variant === "bar" ? (
    <span>
      Connect<span className="hidden min-[420px]:inline"> wallet</span>
    </span>
  ) : (
    "Connect wallet"
  );

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the address stays visible in the menu.
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className={`inline-flex items-center justify-center gap-2.5 whitespace-nowrap border border-line-strong bg-surface font-bold text-ink shadow-chip transition-colors hover:bg-cloud ${
          connected ? "tnum" : ""
        } ${TRIGGER[variant]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={connected && address ? address : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {connected && wallet?.adapter.icon ? (
          <img src={wallet.adapter.icon} alt="" width={18} height={18} className="rounded" />
        ) : (
          <WalletIcon className="shrink-0 text-violet" />
        )}
        {/* In the collapsed sidebar the label stays in the accessible name only. */}
        <span className={variant === "sidebar" ? "sr-only xl:not-sr-only" : undefined}>{label}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute z-40 w-72 max-w-[calc(100vw-2rem)] rounded-[20px] border border-line bg-surface p-2 shadow-pop ${MENU[menuPlacement]}`}
        >
          {connected && address ? (
            <>
              <p className="px-3 pb-2 pt-2 font-mono text-xs break-all text-ink-2">{address}</p>
              <button
                type="button"
                role="menuitem"
                className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-lilac"
                onClick={copyAddress}
              >
                {copied ? "Copied" : "Copy address"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-lilac"
                onClick={() => {
                  setOpen(false);
                  void disconnect();
                }}
              >
                Disconnect
              </button>
            </>
          ) : detected.length > 0 ? (
            <>
              <p className="caps px-3 pb-1 pt-2 text-ink-3">Detected wallets</p>
              {detected.map((w) => (
                <button
                  key={w.adapter.name}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-lilac"
                  onClick={() => {
                    setOpen(false);
                    select(w.adapter.name);
                  }}
                >
                  <img src={w.adapter.icon} alt="" width={22} height={22} className="rounded" />
                  {w.adapter.name}
                </button>
              ))}
            </>
          ) : (
            <div className="px-3 py-2 text-sm text-ink-2">
              <p>No Solana wallet detected in this browser.</p>
              <p className="mt-2">
                Install a wallet such as{" "}
                <a
                  className="link underline"
                  href="https://phantom.com/download"
                  target="_blank"
                  rel="noreferrer"
                >
                  Phantom
                </a>{" "}
                and reload the page.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
