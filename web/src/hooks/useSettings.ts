import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS } from "../lib/constants";

export interface Settings {
  slippageBps: number; // basis points (50 = 0.5%)
  deadlineMin: number; // minutes
  infiniteApproval: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  slippageBps: 50,
  deadlineMin: 20,
  infiniteApproval: false
};

function read(): Settings {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const slip = Number(localStorage.getItem(STORAGE_KEYS.slippage));
    const dl = Number(localStorage.getItem(STORAGE_KEYS.deadlineMin));
    const infRaw = localStorage.getItem(STORAGE_KEYS.infiniteApproval);
    return {
      slippageBps: Number.isFinite(slip) && slip >= 0 ? slip : DEFAULT_SETTINGS.slippageBps,
      deadlineMin: Number.isFinite(dl) && dl > 0 ? dl : DEFAULT_SETTINGS.deadlineMin,
      infiniteApproval: infRaw === "true"
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(read);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.slippage, String(settings.slippageBps));
    localStorage.setItem(STORAGE_KEYS.deadlineMin, String(settings.deadlineMin));
    localStorage.setItem(STORAGE_KEYS.infiniteApproval, String(settings.infiniteApproval));
  }, [settings]);

  const setSlippageBps = useCallback((bps: number) => {
    setSettings((s) => ({ ...s, slippageBps: Math.max(0, Math.min(5000, Math.round(bps))) }));
  }, []);

  const setDeadlineMin = useCallback((m: number) => {
    setSettings((s) => ({ ...s, deadlineMin: Math.max(1, Math.round(m)) }));
  }, []);

  const setInfiniteApproval = useCallback((on: boolean) => {
    setSettings((s) => ({ ...s, infiniteApproval: on }));
  }, []);

  return { ...settings, setSlippageBps, setDeadlineMin, setInfiniteApproval };
}
