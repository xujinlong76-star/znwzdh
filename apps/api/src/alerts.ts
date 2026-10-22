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
const ALERT_DEDUPE_WINDOW_MS = 5 * 60_000;
const ALERT_MAX_ATTEMPTS = 3;
const recentAlerts = new Map<string, number>();

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
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(String(url).trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const key = detail.kind + "\u0000" + detail.error.slice(0, 200) + "\u0000" + message.slice(0, 200);
  const now = Date.now();
  const last = recentAlerts.get(key);
  if (last !== undefined && now - last < ALERT_DEDUPE_WINDOW_MS) return true;
  if (recentAlerts.size > 1_000) {
    for (const [k, at] of recentAlerts) {
      if (now - at >= ALERT_DEDUPE_WINDOW_MS) recentAlerts.delete(k);
    }
  }

  // 单次失败不重试就丢弃，最容易在 webhook 侧 5xx/重启窗口里静默漏告警。
  for (let attempt = 1; attempt <= ALERT_MAX_ATTEMPTS; attempt++) {
    if (await postOnce(parsed.toString(), message, detail, timeoutMs)) {
      recentAlerts.set(key, Date.now());
      return true;
    }
    if (attempt < ALERT_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  // 不记录 URL（可能含机器人 token），只记录失败事实
  console.warn("[navhub-alert] webhook 投递失败，已重试 " + ALERT_MAX_ATTEMPTS + " 次", { kind: detail.kind });
  return false;
}
