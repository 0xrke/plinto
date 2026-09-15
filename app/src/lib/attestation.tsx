"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "stockfloor.attestation.non-us.v1";

interface AttestationValue {
  /** The viewer confirmed they are not a US person and not in a restricted jurisdiction. */
  attested: boolean;
  setAttested: (value: boolean) => void;
}

const AttestationContext = createContext<AttestationValue | null>(null);

export function AttestationProvider({ children }: { children: ReactNode }) {
  const [attested, setAttestedState] = useState(false);

  useEffect(() => {
    try {
      setAttestedState(window.localStorage.getItem(STORAGE_KEY) === "yes");
    } catch {
      // Storage can be unavailable (private mode, blocked site data); default to not attested.
    }
  }, []);

  const setAttested = useCallback((value: boolean) => {
    setAttestedState(value);
    try {
      if (value) window.localStorage.setItem(STORAGE_KEY, "yes");
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures; the in-memory state still applies for this session.
    }
  }, []);

  return (
    <AttestationContext.Provider value={{ attested, setAttested }}>{children}</AttestationContext.Provider>
  );
}

export function useAttestation(): AttestationValue {
  const value = useContext(AttestationContext);
  if (!value) throw new Error("useAttestation must be used inside <AttestationProvider>");
  return value;
}
