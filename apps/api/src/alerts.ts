/**
 * 任务失败告警的 webhook 投递。
 *
 * 设计约束：
 *  - URL 来自运维配置（非用户输入），允许内网地址（内网机器人是常见目标），
 *    因此不走 SSRF 守卫；但协议限定 http/https，防 `file://` 这类误配。
 *  - 永不抛错：投递失败返回 false，Runner 本体不受影响。
 *  - 超时钳制在 1s~30s：太短内网抖动误杀，太长拖住 tick（虽然调用方 fire-and-forget）。
 */

export interface WebhookAlertPayload {
  /** 固定来源标识，接收方可据此做路由 */
  source: "navhub-jobs";
  /** 人类可读的一句话（如飞书 text） */
  text: string;
  detail: { kind: string; attempts: number; error: string };
  /** 发送时间（毫秒时间戳） */
  at: number;
}

export function clampWebhookTimeout(ms: unknown): number {
  const n = typeof ms === "number" && Number.isFinite(ms) ? ms : 5000;
  return Math.min(Math.max(n, 1000), 30_000);
}

/** 同一 kind+error+message 的告警去重窗口（多实例同时失败时不刷屏） */
export const ALERT_DEDUPE_WINDOW_MS = 5 * 60_000;
const ALERT_MAX_ATTEMPTS = 3;

/**
 * 告警去重的抽象。
 *
 * 进程内 Map 只能挡住单副本内的重复；多副本部署时每个副本都会各发一条
 * （Runner 有单实例锁，但锁只保证一个副本跑任务，告警 webhook 是跨轮次共享的）。
 * `claim` 必须是原子的：两个副本并发调用最多一个拿到 true。
 */
export interface AlertDeduper {
  /** true = 本次应当投递；false = 窗口内已有实例投过 */
  claim(key: string, now: number): Promise<boolean>;
  /** 投递最终失败时释放占位，让下一轮/其它实例还能再试 */
  release(key: string): Promise<void>;
}

/** 进程内去重（默认实现；单实例部署已足够） */
export class MemoryAlertDeduper implements AlertDeduper {
  private readonly windowMs: number;
  private readonly entries = new Map<string, number>();

  constructor(windowMs = ALERT_DEDUPE_WINDOW_MS) {
    this.windowMs = Math.max(1, windowMs);
  }

  async claim(key: string, now: number): Promise<boolean> {
    const last = this.entries.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.entries.set(key, now);
    if (this.entries.size > 1_000) {
      for (const [k, at] of this.entries) {
        if (now - at >= this.windowMs) this.entries.delete(k);
      }
    }
    return true;
  }

  async release(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

const defaultDeduper = new MemoryAlertDeduper();

async function postOnce(
  url: string,
  message: string,
  detail: { kind: string; attempts: number; error: string },
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clampWebhookTimeout(timeoutMs));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "NavHubAlert/0.1" },
      body: JSON.stringify({
        source: "navhub-jobs",
        text: message,
        detail,
        at: Date.now(),
      } satisfies WebhookAlertPayload),
      signal: controller.signal,
    });
    // 消费掉 body 再判断：不断开半开连接，且 2xx 才算送达
    await res.arrayBuffer().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWebhookAlert(
  url: string,
  message: string,
  detail: { kind: string; attempts: number; error: string },
  timeoutMs = 5000,
  /** 多实例部署传共享 deduper（见 main.ts）；默认进程内去重 */
  deduper: AlertDeduper = defaultDeduper,
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const key = detail.kind + "\u0000" + detail.error.slice(0, 200) + "\u0000" + message.slice(0, 200);
  // 先占坑再投递：并发同键只有第一个能发；发不出去再释放（见下方 for 之后）
  if (!(await deduper.claim(key, Date.now()))) return true;

  // 单次失败不重试就丢弃，最容易在 webhook 侧 5xx/重启窗口里静默漏告警。
  for (let attempt = 1; attempt <= ALERT_MAX_ATTEMPTS; attempt++) {
    if (await postOnce(parsed.toString(), message, detail, timeoutMs)) {
      return true;
    }
    if (attempt < ALERT_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  // 投递失败：释放占位，下一轮 tick / 其它副本仍可再试（不能把告警永久吞掉）
  await deduper.release(key);
  // 不记录 URL（可能含机器人 token），只记录失败事实
  console.warn("[navhub-alert] webhook 投递失败，已重试 " + ALERT_MAX_ATTEMPTS + " 次", { kind: detail.kind });
  return false;
}
