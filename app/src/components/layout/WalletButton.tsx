"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { truncateAddress } from "@/lib/format";

/**
 * Minimal wallet button on top of wallet-adapter-react. Wallets are discovered through
 * wallet-standard, so there is no bundled adapter list.
 */
export function WalletButton() {
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
  const label = connecting
    ? "Connecting…"
    : connected && address
      ? truncateAddress(address)
      : "Connect wallet";

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
        className={connected ? "btn btn-secondary tnum" : "btn btn-primary"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {connected && wallet?.adapter.icon ? (
          <img src={wallet.adapter.icon} alt="" width={18} height={18} className="rounded" />
        ) : null}
        {label}
      </button>
      {open ? (
        <div
          role="menu"
          className="card absolute right-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] p-2 shadow-lg"
        >
          {connected && address ? (
            <>
              <p className="px-2 pb-2 pt-1 font-mono text-xs break-all text-ink-2">{address}</p>
              <button
                type="button"
                role="menuitem"
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-sunken"
                onClick={copyAddress}
              >
                {copied ? "Copied" : "Copy address"}
              </button>
              <button
                type="button"
                role="menuitem"
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-sunken"
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
              <p className="eyebrow px-2 pb-1 pt-1">Detected wallets</p>
              {detected.map((w) => (
                <button
                  key={w.adapter.name}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-sunken"
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
            <div className="px-2 py-2 text-sm text-ink-2">
              <p>No Solana wallet detected in this browser.</p>
              <p className="mt-2">
                Install a wallet such as{" "}
                <a
                  className="font-semibold text-brand underline"
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
