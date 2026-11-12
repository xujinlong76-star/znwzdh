"use client";
import {
  getTopAlgorithmHudChannel,
  useAlgorithmHud,
} from "../lib/algorithm-hud";
import type { ReactNode } from "react";
import type { AlgorithmHudContributions } from "../lib/algorithm-hud";

export function AlgorithmHudBadge({
  contributions,
  personalizationEnabled,
}: {
  contributions: AlgorithmHudContributions | null | undefined;
  personalizationEnabled?: boolean;
}): ReactNode {
  const { enabled, mounted } = useAlgorithmHud();
  if (!mounted || !enabled) return null;
  const top = getTopAlgorithmHudChannel(contributions, {
    personalizationEnabled,
  });
  if (!top) return null;
  return (
    <span
      data-testid="algorithm-hud-badge"
      data-channel={top.channel}
      title={
        "主导通道：" + top.label + "，贡献 " + top.text + "；仅本地展示，不上报"
      }
      className="inline-flex items-center rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
    >
      {top.text}
    </span>
  );
}
