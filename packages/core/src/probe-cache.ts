/**
 * 探活结果缓存 + HTTP 条件请求。
 *
 * 为什么需要：体检与 AI 平替会对同一批 URL 反复发完整 GET——一次自愈最多
 * 4 个候选 × N 个诊断，一轮「全部体检」更是把整包样本重测一遍。绝大多数
 * 站点几小时内不会变，重复请求既慢又给对方添麻烦（也更容易被判成爬虫）。
 *
 * 设计取舍：
 *   - **缓存文件而不是数据库表**。缓存是可再生数据，丢了只会慢一次，
 *     不值得为它引入 DDL 迁移（本仓 SQLite/PG 双方言，加表要维护两套 DDL）。
 *     工业界的链接检查器（lychee 的 `.lycheecache`）同样用文件缓存。
 *   - **条件请求优先**：命中缓存不等于不发请求，而是带 `If-None-Match` /
 *     `If-Modified-Since`；对端回 304 就复用判定并续期。这样既拿到「没变」
 *     的事实，又只花一个头部往返。
 *   - **TTL 按结论分档**：健康站点 7 天，死链 12 小时，未能验证 1 小时——
 *     越是「没测准」的结论越要尽快重测，避免把一次抖动长期当成事实。
 *   - **写入原子**：先写 `.tmp` 再 `rename`，进程被杀也不会留下半个 JSON
 *     （本机曾因磁盘满把源文件写成 0 字节，教训在案）。
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProbeOutcome, ProbeOutcomeKind } from "./probe-policy.ts";

export interface ProbeCacheEntry {
  /** 规范化后的 URL（缓存键） */
  url: string;
  kind: ProbeOutcomeKind;
  status?: number;
  reason: string;
  /** 对端给的校验器，用于下次条件请求 */
  etag?: string;
  lastModified?: string;
  /** 最后一次「确认有效」的时间（304 也会刷新它） */
  checkedAt: number;
}

export interface ProbeCacheOptions {
  /** 最多保留多少条（按 checkedAt LRU 淘汰） */
  maxEntries: number;
  /** 注入时钟，测试用 */
  now: () => number;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * TTL 分档：越不确定的结论越快过期。
 * `ok` 给 7 天是因为「健康」最不容易变、且重测成本最高；
 * `server-error` / `unverified` 给 1 小时是因为它们只描述「某一刻没测准」。
 */
export const PROBE_CACHE_TTL_MS: Record<ProbeOutcomeKind, number> = {
  ok: 7 * DAY,
  blocked: DAY,
  parked: DAY,
  dead: 12 * 60 * 60 * 1000,
  unverified: 60 * 60 * 1000,
  "server-error": 60 * 60 * 1000,
};

/** 规范化缓存键：协议/主机小写、去 hash、去尾斜杠（保留 query，因为它是资源标识的一部分） */
export function probeCacheKey(rawUrl: string): string {
  const raw = rawUrl.trim();
  try {
    const u = new URL(raw);
    u.hash = "";
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString();
  } catch {
    return raw.toLowerCase();
  }
}

export function cacheTtlMs(kind: ProbeOutcomeKind): number {
  return PROBE_CACHE_TTL_MS[kind] ?? PROBE_CACHE_TTL_MS.unverified;
}

export function isFresh(entry: ProbeCacheEntry, now: number): boolean {
  return now - entry.checkedAt < cacheTtlMs(entry.kind);
}

/** 命中未过期缓存时该带的请求头：没有校验器就返回空对象（只能走完整 GET） */
export function conditionalHeaders(entry: ProbeCacheEntry | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!entry) return headers;
  if (entry.etag) headers["If-None-Match"] = entry.etag;
  if (entry.lastModified) headers["If-Modified-Since"] = entry.lastModified;
  return headers;
}

export interface ProbeCacheStore {
  /** 查缓存。`fresh` 为 false 表示「有记录但已过期」，此时应带条件头重测 */
  lookup(rawUrl: string): { entry: ProbeCacheEntry; fresh: boolean } | null;
  /** 记录一次新结论（写入后由 flush 落盘） */
  record(rawUrl: string, outcome: ProbeOutcome, validators?: { etag?: string | null; lastModified?: string | null }): ProbeCacheEntry;
  /** 对端回 304：沿用旧结论，只把 checkedAt 续期 */
  markRevalidated(rawUrl: string): void;
  /** 落盘（原子替换） */
  flush(): Promise<void>;
  readonly size: number;
  /** 清空（含落盘），测试与运维用 */
  clear(): Promise<void>;
}

interface CacheFile {
  version: 1;
  entries: Record<string, ProbeCacheEntry>;
}

function isCacheFile(value: unknown): value is CacheFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<CacheFile>;
  return v.version === 1 && !!v.entries && typeof v.entries === "object";
}

/**
 * 打开（或创建）文件缓存。
 *
 * 损坏文件不抛错：缓存是可再生的，读坏了就当空缓存重建，
 * 让体检继续跑——比因为一个缓存文件把整个面板打挂强。
 */
export async function openProbeCache(
  file: string,
  options: Partial<ProbeCacheOptions> = {},
): Promise<ProbeCacheStore> {
  const opts: ProbeCacheOptions = { maxEntries: 5000, now: () => Date.now(), ...options };
  let entries: Record<string, ProbeCacheEntry> = {};
  let dirty = false;

  try {
    const text = await readFile(file, "utf8");
    const parsed: unknown = JSON.parse(text);
    if (isCacheFile(parsed)) entries = parsed.entries;
  } catch {
    entries = {};
  }

  function evictIfNeeded(): void {
    const keys = Object.keys(entries);
    if (keys.length <= opts.maxEntries) return;
    // LRU：最久没被确认的条目先淘汰
    keys
      .sort((a, b) => (entries[a]?.checkedAt ?? 0) - (entries[b]?.checkedAt ?? 0))
      .slice(0, keys.length - opts.maxEntries)
      .forEach((key) => {
        delete entries[key];
      });
  }

  const store: ProbeCacheStore = {
    lookup(rawUrl) {
      const key = probeCacheKey(rawUrl);
      const entry = entries[key];
      if (!entry) return null;
      return { entry, fresh: isFresh(entry, opts.now()) };
    },
    record(rawUrl, outcome, validators) {
      const key = probeCacheKey(rawUrl);
      const entry: ProbeCacheEntry = {
        url: key,
        kind: outcome.kind,
        ...(outcome.status !== undefined ? { status: outcome.status } : {}),
        reason: outcome.reason,
        ...(validators?.etag ? { etag: validators.etag } : {}),
        ...(validators?.lastModified ? { lastModified: validators.lastModified } : {}),
        checkedAt: opts.now(),
      };
      entries[key] = entry;
      evictIfNeeded();
      dirty = true;
      return entry;
    },
    markRevalidated(rawUrl) {
      const key = probeCacheKey(rawUrl);
      const entry = entries[key];
      if (!entry) return;
      entries[key] = { ...entry, checkedAt: opts.now() };
      dirty = true;
    },
    async flush() {
      if (!dirty) return;
      const payload: CacheFile = { version: 1, entries };
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(payload), "utf8");
      try {
        await rename(tmp, file);
      } catch (err) {
        await unlink(tmp).catch(() => {});
        throw err;
      }
      dirty = false;
    },
    get size() {
      return Object.keys(entries).length;
    },
    async clear() {
      entries = {};
      dirty = true;
      await store.flush();
    },
  };

  return store;
}
