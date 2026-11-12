import { useCallback, useEffect, useState } from "react";
export const ALGORITHM_HUD_STORAGE_KEY = "navhub.algorithm-hud.v1";
export const ALGORITHM_HUD_CHANGE_EVENT = "navhub.algorithm-hud.v1:change";
export const ALGORITHM_HUD_CHANNEL_LABELS: Record<string, string> = {
  exact: "精确",
  fts: "全文",
  pinyin: "拼音",
  semantic: "语义",
  personal: "个性化",
};

export type AlgorithmHudContributions = Record<
  string,
  { rank?: number; value?: number } | null | undefined
>;
export type AlgorithmHudTopChannel = {
  channel: string;
  label: string;
  rank: number;
  value: number;
  text: string;
};

export function parseAlgorithmHudStoredValue(
  raw: string | null | undefined,
): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { enabled?: unknown };
    return parsed?.enabled === true;
  } catch {
    return false;
  }
}

export function readAlgorithmHudEnabled(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return parseAlgorithmHudStoredValue(
      window.localStorage.getItem(ALGORITHM_HUD_STORAGE_KEY),
    );
  } catch {
    return false;
  }
}

export function writeAlgorithmHudEnabled(enabled: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      ALGORITHM_HUD_STORAGE_KEY,
      JSON.stringify({ enabled }),
    );
    window.dispatchEvent(new CustomEvent(ALGORITHM_HUD_CHANGE_EVENT));
  } catch {
    /* localStorage unavailable */
  }
}

export function formatAlgorithmHudValue(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  return value >= 0.1 ? value.toFixed(2) : value.toFixed(3);
}

export function getTopAlgorithmHudChannel(
  contributions: AlgorithmHudContributions | null | undefined,
  options?: { personalizationEnabled?: boolean },
): AlgorithmHudTopChannel | null {
  if (!contributions) return null;
  const entries = Object.entries(contributions).filter(([channel, c]) => {
    if (!ALGORITHM_HUD_CHANNEL_LABELS[channel]) return false;
    if (channel === "personal" && options?.personalizationEnabled === false)
      return false;
    return c != null && Number.isFinite(c.value);
  });
  if (entries.length === 0) return null;
  entries.sort(
    (a, b) =>
      (b[1]?.value ?? 0) - (a[1]?.value ?? 0) ||
      (a[1]?.rank ?? 999) - (b[1]?.rank ?? 999) ||
      a[0].localeCompare(b[0]),
  );
  const [channel, c] = entries[0];
  const value = c?.value ?? 0;
  const text = formatAlgorithmHudValue(value);
  if (text === null) return null;
  return {
    channel,
    label: ALGORITHM_HUD_CHANNEL_LABELS[channel],
    rank: c?.rank ?? 999,
    value,
    text: channel.toUpperCase() + " " + text,
  };
}

export function useAlgorithmHud(): {
  enabled: boolean;
  mounted: boolean;
  toggle: () => void;
} {
  const [enabled, setEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setEnabled(readAlgorithmHudEnabled());
    setMounted(true);
    const sync = () => setEnabled(readAlgorithmHudEnabled());
    window.addEventListener("storage", sync);
    window.addEventListener(ALGORITHM_HUD_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(ALGORITHM_HUD_CHANGE_EVENT, sync);
    };
  }, []);
  const toggle = useCallback(() => {
    // updater 内禁止副作用：React 可能对同一点击重复调用 updater，
    // 写存储放在 updater 内会使一次点击写入两次（先 true 后 false）。
    // 以 localStorage（事实源）为准单次取反写回。
    const next = !readAlgorithmHudEnabled();
    writeAlgorithmHudEnabled(next);
    setEnabled(next);
  }, []);
  return { enabled, mounted, toggle };
}
