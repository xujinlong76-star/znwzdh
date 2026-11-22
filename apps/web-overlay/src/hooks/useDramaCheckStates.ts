/**
 * 服务端短剧新集检查状态（GET /api/me/drama-check-states）。
 *
 * 只读一次（挂载时拉取，失败静默退化为空——“已更至第 X 集”与“有新集”
 * 只是增值显示，读不到时不显示、不挂页、不弹错）。匿名身份服务端返 []，
 * 未登录时同样只有空结果（匿名用户的检查状态只在本地算）。
 */
import { useEffect, useState } from "react";
import type { DramaCheckStatesResponse } from "@/lib/rest-contracts.generated";
import type { DramaCheckState } from "@/lib/drama-watch-stats";

export interface DramaCheckStatesResult {
  /** 取数完成（失败也算完成，此时 byKey 为空）。 */
  ready: boolean;
  /** 按 dramaKey（platformSiteId::归一化剧名，与清单条目 key 同值）索引。 */
  byKey: ReadonlyMap<string, DramaCheckState>;
}

export function useDramaCheckStates(): DramaCheckStatesResult {
  const [byKey, setByKey] = useState<ReadonlyMap<string, DramaCheckState>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/me/drama-check-states", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          /*
           * 2026-11-22：错误响应也必须消费/取消 body，否则浏览器把连接挂在
           * keep-alive 里不释放——/drama 首屏这条 401 会让 networkidle 永远
           * 等不到（实测 requestfinished 20 秒不触发，页面看似卡死）。
           */
          void res.body?.cancel().catch(() => { /* 连接已断开时忽略 */ });
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<DramaCheckStatesResponse>;
      })
      .then((data) => {
        if (!alive) return;
        const next = new Map<string, DramaCheckState>();
        for (const state of data.states ?? []) {
          if (typeof state.dramaKey !== "string" || !state.dramaKey) continue;
          next.set(state.dramaKey, {
            dramaKey: state.dramaKey,
            latestEpisode:
              typeof state.latestEpisode === "number" ? state.latestEpisode : null,
            lastCheckedAt:
              typeof state.lastCheckedAt === "number" ? state.lastCheckedAt : 0,
            lastError: typeof state.lastError === "string" ? state.lastError : null,
          });
        }
        setByKey(next);
      })
      .catch(() => {
        // 读不到只退化为空：增值显示不显示，不阻断页面。
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { ready, byKey };
}
