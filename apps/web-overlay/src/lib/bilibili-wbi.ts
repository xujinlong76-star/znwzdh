/**
 * B 站 wbi 签名。
 *
 * 为什么必须有：`/x/web-interface/wbi/search/type` 这个接口名里的 `wbi` 就是「要签名」。
 * 不签名的请求会被风控挡掉，返回 `code: -352`（风控校验失败）或 `-412`。
 * 采集链路原来直接拼 URL 不带签名，实测返回空 body —— 代码里 `res.ok` 为真、
 * `json?.data?.result` 为空，于是被当成「没有搜到好稿件」，报告显示 +0 而任务报成功。
 *
 * 算法（社区公开、非官方文档）：
 *   1. GET `/x/web-interface/nav`（未登录也返回），取 `data.wbi_img.img_url` / `sub_url`；
 *   2. 两个 URL 的文件名去扩展名得到 imgKey / subKey；
 *   3. 拼成 64 字符，按下面的置换表取 32 位 = mixinKey（每天轮换，需缓存）；
 *   4. 业务参数 + `wts`（秒级时间戳）按 key 字典序拼 query，
 *      `w_rid = md5(query + mixinKey)`，最终 URL 追加 `wts` 与 `w_rid`。
 *
 * 注意：本文件依赖 `node:crypto`，**只能在服务端模块引用**（采集器本来就在 route 里跑）。
 * 密钥缓存放进程内，多副本各自维护；过期或被拒时重新拉一次即可。
 */
import { createHash } from 'node:crypto'

/** 官方前端的置换表（顺序固定，改动即失效） */
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
] as const

const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
const KEY_TTL_MS = 6 * 60 * 60 * 1000 // 官方约每天轮换一次，6 小时刷新足够

export const BILI_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com',
} as const

/** 从 `https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png` 取 `7cd0…77c` */
export function extractWbiKey(url: string): string {
  const file = (url || '').split('/').pop() ?? ''
  return file.split('.')[0] ?? ''
}

/** 由 imgKey/subKey 推出 32 位 mixinKey */
export function getMixinKey(imgKey: string, subKey: string): string {
  const raw = imgKey + subKey
  return MIXIN_KEY_ENC_TAB.map(i => raw[i] ?? '').join('').slice(0, 32)
}

/**
 * 生成签名后的 query 字符串。
 *
 * 参数过滤规则与官方一致：去掉 `!'()*` 字符；按 key 字典序拼接。
 * `wts` 由调用方传入（测试需要固定时间，否则结果不可复现）。
 */
export function signWbiQuery(
  params: Record<string, string | number | undefined>,
  mixinKey: string,
  wts: number,
): { query: string; wRid: string; wts: number } {
  const merged: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    merged[k] = String(v).replace(/[!'()*]/g, '')
  }
  merged.wts = String(wts)

  const query = Object.keys(merged)
    .sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(merged[k]!)}`)
    .join('&')

  const wRid = createHash('md5').update(query + mixinKey, 'utf8').digest('hex')
  return { query: `${query}&w_rid=${wRid}`, wRid, wts }
}

interface CachedMixin {
  mixinKey: string
  fetchedAt: number
}

let cache: CachedMixin | null = null
/** 并发去重：多个关键词同时冷启动时只打一次 nav 接口 */
let inflight: Promise<string | null> | null = null

async function fetchMixinKey(timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(NAV_URL, {
      headers: { ...BILI_HEADERS },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      code?: number
      data?: { wbi_img?: { img_url?: string; sub_url?: string } }
    }
    const img = extractWbiKey(json?.data?.wbi_img?.img_url ?? '')
    const sub = extractWbiKey(json?.data?.wbi_img?.sub_url ?? '')
    if (!img || !sub) return null
    const mixinKey = getMixinKey(img, sub)
    if (mixinKey.length !== 32) return null
    cache = { mixinKey, fetchedAt: Date.now() }
    return mixinKey
  } catch {
    return null
  }
}

/**
 * 取当前可用的 mixinKey。
 *
 * 返回 `null` 表示**拿不到签名能力**（nav 接口失败 / 结构变化）。调用方应据此
 * 降级为「无签名请求」并把原因写进报告的 degraded 字段，而不是静默当成没搜到。
 */
export async function getWbiMixinKey(options?: {
  timeoutMs?: number
  forceRefresh?: boolean
}): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 4000
  const fresh = cache && Date.now() - cache.fetchedAt < KEY_TTL_MS
  if (fresh && !options?.forceRefresh) return cache!.mixinKey

  if (!inflight) {
    inflight = fetchMixinKey(timeoutMs).finally(() => {
      inflight = null
    })
  }
  return inflight
}

/** 仅供测试：清空密钥缓存 */
export function resetWbiCacheForTest(): void {
  cache = null
  inflight = null
}
