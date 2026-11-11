/**
 * 热榜刷新：逐源低频拉取 → 解析 → 整表替换缓存。
 *
 * 失败口径（与链接巡检一致）：单源失败只标该源 failed 并保留上次成功
 * 的条目，绝不清空、绝不让一个源拖垮整轮；刷新本身不抛错，
 * 结果以 summary 形式回给任务/日志。
 */
import { guardedFetch } from "@navhub/ai";
import type { AppContext } from "../context.ts";
import { HOTLIST_SOURCES, type HotlistSourceDef } from "./sources.ts";

export type HotlistFetch = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; body: string }>;

/** 生产取数：走站内统一的 SSRF 安全抓取（与 health_check 同一套 guard 配置） */
export function makeGuardedHotlistFetch(ctx: AppContext): HotlistFetch {
  return async (url, headers) => {
    const res = await guardedFetch(url, { ...ctx.config.fetch }, { headers });
    return { status: res.status, body: res.body };
  };
}

export interface HotlistRefreshEntry {
  source: string;
  ok: boolean;
  items?: number;
  error?: string;
}

export interface HotlistRefreshSummary {
  at: number;
  entries: HotlistRefreshEntry[];
  okCount: number;
}

export async function refreshHotlistSource(
  ctx: AppContext,
  def: HotlistSourceDef,
  fetchImpl: HotlistFetch,
  now: number,
): Promise<HotlistRefreshEntry> {
  try {
    if (!def.endpoint || !def.parse) throw new Error("源未配置采集端点");
    const res = await fetchImpl(def.endpoint, def.headers ?? {});
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new Error("响应不是合法 JSON");
    }
    const items = def.parse(json);
    await ctx.repo.replaceHotlistSource(def.id, items, now);
    return { source: def.id, ok: true, items: items.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.repo.markHotlistSourceFailed(def.id, message, now).catch(() => undefined);
    return { source: def.id, ok: false, error: message };
  }
}

/** 全源刷新（并行；单源最长受 guard 超时约束，整轮不会被某个源拖死） */
export async function refreshHotlist(
  ctx: AppContext,
  opts: { fetchImpl?: HotlistFetch; now?: number } = {},
): Promise<HotlistRefreshSummary> {
  const now = opts.now ?? Date.now();
  const fetchImpl = opts.fetchImpl ?? makeGuardedHotlistFetch(ctx);
  const covered = HOTLIST_SOURCES.filter((s) => s.covered);
  const entries = await Promise.all(covered.map((def) => refreshHotlistSource(ctx, def, fetchImpl, now)));
  return { at: now, entries, okCount: entries.filter((e) => e.ok).length };
}
