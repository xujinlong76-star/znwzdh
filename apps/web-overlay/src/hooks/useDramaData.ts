/**
 * /drama 页共享取数：真榜单 + 开播日历。
 *
 * 两个区块（榜单区、日历区）与页内搜索共用同一份数据：模块级缓存保证
 * 同一页只拉一次（首个调用者触发 fetch，其余复用同一个 promise）。
 * 状态机与日历区老口径一致：loading / failed / ready；失败不挂页，
 * 各自区块只留一行说明。
 */
import { useEffect, useState } from "react";
import type {
  DramaCalendarResponse,
  DramaRankingsResponse,
} from "@/lib/rest-contracts.generated";

export type DramaDataState<T> =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; data: T };

const cache = new Map<string, Promise<unknown>>();
// 榜单/日历是每 30 秒级更新的数据：成功结果只缓存一小段时间，离开页面再回来
// 能拿到新数据；此前永久缓存要硬刷新才更新，列表陈旧。同会话内并发挂载仍共享同一请求。
const CACHE_TTL_MS = 30_000;

function fetchJsonOnce<T>(url: string): Promise<T> {
  const hit = cache.get(url) as Promise<T> | undefined;
  if (hit) return hit;
  const promise = fetch(url, { headers: { Accept: "application/json" } }).then(
    async (res) => {
      if (!res.ok) { /* 响应体无需读取：释放 keep-alive 连接，避免 networkidle 卡死；取消失败说明连接已断开，可忽略 */
          void res.body?.cancel().catch(() => { /* 连接已断开，无需处理 */ }); throw new Error(`HTTP ${res.status}`); }
      return (await res.json()) as T;
    },
  );
  // 失败的 promise 不缓存：下次挂载可重试。
  promise.catch(() => {
    if (cache.get(url) === promise) cache.delete(url);
  });
  // 成功后按 TTL 失效：只删仍属于自己的那一项，避免误删后来覆盖的新请求。
  promise.then(() => {
    setTimeout(() => {
      if (cache.get(url) === promise) cache.delete(url);
    }, CACHE_TTL_MS).unref?.();
  }).catch(() => { /* 失败分支上面已清理，这里仅避免 then 链未处理拒绝 */ });
  cache.set(url, promise);
  return promise;
}

function useDramaData<T>(url: string): DramaDataState<T> {
  const [state, setState] = useState<DramaDataState<T>>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    fetchJsonOnce<T>(url)
      .then((data) => {
        if (alive) setState({ kind: "ready", data });
      })
      .catch(() => {
        if (alive) setState({ kind: "failed" });
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

/** 搜短剧真榜单（三榜快照）：/drama 榜单区 + 页内搜索语料共用。 */
export function useDramaRankings(): DramaDataState<DramaRankingsResponse> {
  return useDramaData<DramaRankingsResponse>("/api/hub/drama/rankings");
}

/** 开播日历（预约榜快照）：/drama 日历区 + 页内搜索语料共用。 */
export function useDramaCalendar(): DramaDataState<DramaCalendarResponse> {
  return useDramaData<DramaCalendarResponse>("/api/hub/drama/calendar");
}
