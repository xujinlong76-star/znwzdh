/**
 * 前端错误闭环（P2-5）的进程内聚合。
 *
 * 背景：`lib/error-report.ts`（前端）早已把崩溃分成 chunk / network /
 * hydration / storage / runtime 五类并给出用户文案，但分类结果**只活在
 * 崩溃的那个标签页里**——服务端看不到，运营只能等用户反馈才发现
 * 「发版后白屏了」。
 *
 * 这里补上服务端那一半：
 *   - 前端只上报**脱敏后的摘要**（kind + pathname + digest + 消息指纹），
 *     不带 URL query、不带任何用户内容（见 routes/errors.ts 与前端
 *     `lib/client-error-report.ts` 的指纹方案）；
 *   - 本模块在 API 进程内做**按指纹去重 + 计数**，同一错误 1000 次只留
 *     一条记录（count=1000），避免错误风暴把 events 表写爆；
 *   - 明细同时写入 events 表（kind=client_error）供长期审计，
 *     聚合视图走内存，秒级可见。
 *
 * 为什么是内存而不是表：看板要的是「最近发生了什么」，进程重启丢失可接受
 * （events 表里仍有全量）；且这样完全不依赖 JSON 提取方言（sqlite / PG
 * 双轨下的 json_extract 并不通用）。
 *
 * 分类枚举与前端 `lib/error-report.ts` 的 CrashKind 是同一套值，但两边
 * **各自定义**：API 侧不 import 前端代码（部署边界），加新类时改两处。
 */

/** 与前端 CrashKind 同值的五个分类（值由前端分类后上传） */
export const CLIENT_ERROR_KINDS = ["chunk", "network", "hydration", "storage", "runtime"] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

/** 去重键：同类同纹同路径同 digest 视为同一错误 */
export function clientErrorKey(input: {
  kind: ClientErrorKind;
  fingerprint: string;
  path?: string;
  digest?: string;
}): string {
  return [input.kind, input.fingerprint, input.path ?? "-", input.digest ?? "-"].join("|");
}

export interface ClientErrorEntry {
  kind: ClientErrorKind;
  /** 消息指纹（SHA-256 前 12 位），不含原文 */
  fingerprint: string;
  path: string | null;
  digest: string | null;
  /** 去重后累计次数 */
  count: number;
  firstSeen: number;
  lastSeen: number;
}

/** 纯函数：把若干条目汇总成看板视图（最近优先，按 kind 计数） */
export function summarizeClientErrors(
  entries: ClientErrorEntry[],
  limit = 20,
): {
  total: number;
  byKind: Record<ClientErrorKind, number>;
  recent: ClientErrorEntry[];
} {
  const byKind: Record<ClientErrorKind, number> = {
    chunk: 0,
    network: 0,
    hydration: 0,
    storage: 0,
    runtime: 0,
  };
  let total = 0;
  for (const e of entries) {
    byKind[e.kind] += e.count;
    total += e.count;
  }
  const recent = [...entries]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, Math.max(1, Math.min(limit, 100)));
  return { total, byKind, recent };
}

export class ClientErrorStore {
  private entries = new Map<string, ClientErrorEntry>();

  constructor(private readonly capacity = 200) {}

  /** 记录一条（同键累计 count 并刷新 lastSeen；超容量时淘汰最旧条目） */
  record(input: {
    kind: ClientErrorKind;
    fingerprint: string;
    path?: string | null;
    digest?: string | null;
    now?: number;
  }): ClientErrorEntry {
    const now = input.now ?? Date.now();
    const key = clientErrorKey({
      kind: input.kind,
      fingerprint: input.fingerprint,
      path: input.path ?? undefined,
      digest: input.digest ?? undefined,
    });
    const hit = this.entries.get(key);
    if (hit) {
      hit.count += 1;
      hit.lastSeen = now;
      return hit;
    }
    const entry: ClientErrorEntry = {
      kind: input.kind,
      fingerprint: input.fingerprint,
      path: input.path ?? null,
      digest: input.digest ?? null,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    };
    this.entries.set(key, entry);
    if (this.entries.size > this.capacity) {
      // 淘汰 lastSeen 最旧的一条（保持容量有界）
      let oldestKey: string | null = null;
      let oldest = Number.POSITIVE_INFINITY;
      for (const [k, v] of this.entries) {
        if (v.lastSeen < oldest) {
          oldest = v.lastSeen;
          oldestKey = k;
        }
      }
      if (oldestKey) this.entries.delete(oldestKey);
    }
    return entry;
  }

  list(): ClientErrorEntry[] {
    return [...this.entries.values()];
  }

  summary(limit = 20) {
    return summarizeClientErrors(this.list(), limit);
  }

  clear(): void {
    this.entries.clear();
  }
}
