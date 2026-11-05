/**
 * Bilibili 高清视频流解析器（官方通道优先 + 第三方解析接口末位兜底的集群自动故障转移）
 *
 * 解析引擎（升级方案 3.3 合规倒置后的顺序）：
 *   1. B 站官方 WBI 签名高画质 PlayUrl 通道 —— 防风控能力最强
 *   2. B 站官方免登录 Web HTML5 720P 直连通道
 *   3. B 站官方 PC 客户端兼容 PlayUrl 通道
 *   4. B 站官方 Android 客户端移动流通道
 *   5. 第三方兜底 1：星之阁 API (https://api.xingzhige.com/doc/40)
 *   6. 第三方兜底 2：米人 API (https://api.mir6.com/api/bzjiexi)
 *   7. 终极兜底：B 站官方高画质内嵌播放器 (player.bilibili.com/player.html?high_quality=1)
 *
 * 第三方通道可用 `NAVHUB_BILI_DISABLE_THIRD_PARTY=1` 完全关闭（官方通道失败时
 * 直接走内嵌兜底，不再向不受控外部服务转发任何信息）。
 */

import { getWbiMixinKey, signWbiQuery, BILI_HEADERS } from '@/lib/bilibili-wbi'
import {
  buildBilibiliEmbedUrl,
  ensureHttpsUrl,
  normalizeBilibiliTarget,
  type BilibiliHdParseInput,
  type BilibiliParseEngineSource,
} from '@/lib/video-bilibili-hd-url'

// 纯 URL/标识辅助函数已挪到 video-bilibili-hd-url.ts（浏览器端可 import，见该文件头注释）。
// 这里原样再导出：服务端调用点与既有测试的 import 路径保持不变。
export { buildBilibiliEmbedUrl, ensureHttpsUrl, normalizeBilibiliTarget } from '@/lib/video-bilibili-hd-url'
export type { BilibiliHdParseInput, BilibiliParseEngineSource } from '@/lib/video-bilibili-hd-url'

export const XINGZHIGE_BILI_PARSE_ENDPOINT = 'https://api.xingzhige.com/API/b_parse/'
export const MIR6_BILI_PARSE_ENDPOINT = 'https://api.mir6.com/api/bzjiexi'

export interface BilibiliHdParsedOwner {
  name: string
  mid?: number | string
  face?: string
}

export interface BilibiliHdParsedStat {
  view: number
  reply: number
  favorite: number
  like: number
  coin: number
  share: number
  danmaku: number
  ctime?: number
  time?: string
}

export interface BilibiliHdParseResult {
  /** 是否成功解析出可播放的高清直链 */
  ok: boolean
  /** 解析来源引擎 */
  source: BilibiliParseEngineSource
  /** 规范化后的 B 站视频页面地址 */
  canonicalUrl: string
  bvid?: string
  aid?: string
  cid?: string
  p: number
  /** 视频标题 */
  title?: string
  /** 视频简介 */
  desc?: string
  /** 强制升级为 https:// 的高清封面地址 */
  coverUrl?: string
  /** 画质标签，例如 "高清 720P"、"高清 1080P" */
  qualityLabel: string
  /** 解析出的 CDN MP4 直链（upos-*.bilivideo.com） */
  streamUrl?: string
  /** 同源 Range 流媒体代理地址（当浏览器直连 CDN 受阻时自动切换） */
  proxyStreamUrl?: string
  /** 官方播放器 iframe 兜底地址（强制 https:// 且带 high_quality=1） */
  embedUrl: string
  /** UP 主信息 */
  owner?: BilibiliHdParsedOwner
  /** 视频互动数据 */
  stat?: BilibiliHdParsedStat
  /** 直链过期时间戳（毫秒），用于缓存自动失效 */
  expiresAt: number
  /** 降级或失败原因说明 */
  errorReason?: string
  /**
   * 请求里带的 access_key 没有被交给任何上游（本部署未开启出站转发）。
   * 界面必须据此说明，否则用户以为「大会员画质解锁生效了」，实际拿到的是免登录档。
   */
  accessKeyIgnored?: boolean
}

/** 星之阁 API 原始响应结构（doc/40） */
export interface XingzhigeBiliParseRawResponse {
  code: number
  msg?: string
  data?: {
    bvid?: string
    aid?: number | string
    cid?: number | string
    video?: {
      title?: string
      fm?: string
      lx?: string
      desc?: string
      max_qxd?: string
      url?: string
    }
    owner?: {
      name?: string
      mid?: number | string
      face?: string
    }
    stat?: {
      view?: number
      reply?: number
      favorite?: number
      like?: number
      coin?: number
      share?: number
      danmuku?: number
      danmaku?: number
      ctime?: number
      time?: string
    }
    type?: string
  } | null
}

/** 米人 API 原始响应结构 */
export interface Mir6BiliParseRawResponse {
  code: number
  msg?: string
  title?: string
  imgurl?: string
  desc?: string
  data?: Array<{
    title?: string
    duration?: number
    durationFormat?: string
    accept?: string[]
    video_url?: string
  }>
  user?: {
    name?: string
    user_img?: string
  }
}

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000
const STREAM_CACHE_MAX_SIZE = 200
const streamCache = new Map<string, BilibiliHdParseResult>()

/**
 * 校验目标 URL 是否属于合法的 B 站视频流 CDN 域名（严格白名单，防止流代理接口被滥用为 SSRF 跳板）
 */
export function isAllowedBilivideoStreamHost(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false
    }
    const host = parsed.hostname.toLowerCase()
    return (
      host.endsWith('.bilivideo.com') ||
      host.endsWith('.bilivideo.cn') ||
      host.endsWith('.hdslb.com') ||
      host.endsWith('.akamaized.net') ||
      host.endsWith('.biliapi.net')
    )
  } catch {
    return false
  }
}

export function extractStreamExpiresAt(streamUrl: string, nowMs: number = Date.now()): number {
  try {
    const parsed = new URL(streamUrl)
    const deadlineParam = parsed.searchParams.get('deadline') || parsed.searchParams.get('expires')
    if (deadlineParam && /^\d{9,11}$/.test(deadlineParam)) {
      const deadlineMs = Number.parseInt(deadlineParam, 10) * 1000
      if (deadlineMs > nowMs + 60_000) {
        return Math.min(deadlineMs - 60_000, nowMs + DEFAULT_CACHE_TTL_MS)
      }
    }
  } catch {
    // ignore
  }
  return nowMs + DEFAULT_CACHE_TTL_MS
}

/**
 * 辅助函数：根据 bvid 或 aid 查询并补齐视频基本信息与分 P 的 cid
 */
async function fetchBiliVideoInfo(
  target: { bvid?: string; aid?: string; p: number },
  fetchImpl: typeof fetch
): Promise<{
  bvid?: string
  aid?: string
  cid?: string
  title?: string
  desc?: string
  coverUrl?: string
  owner?: BilibiliHdParsedOwner
  stat?: BilibiliHdParsedStat
}> {
  const headers = {
    ...BILI_HEADERS,
    'Referer': 'https://www.bilibili.com/',
  }
  const viewParam = target.bvid
    ? `bvid=${encodeURIComponent(target.bvid)}`
    : `aid=${encodeURIComponent(target.aid || '')}`

  const viewRes = await fetchImpl(`https://api.bilibili.com/x/web-interface/view?${viewParam}`, {
    headers,
    signal: AbortSignal.timeout(6000),
  })
  if (!viewRes.ok) {
    throw new Error(`B 站 view 接口返回 HTTP ${viewRes.status}`)
  }
  const viewJson = await viewRes.json()
  if (viewJson?.code !== 0 || !viewJson?.data) {
    throw new Error(viewJson?.message || `B 站 view 接口错误 (code=${viewJson?.code})`)
  }

  const vd = viewJson.data
  const pages: Array<{ page?: number; cid?: number | string }> = Array.isArray(vd.pages) ? vd.pages : []
  const matchedPage = pages.find(pg => pg.page === target.p) || pages[target.p - 1]
  const resolvedCid = matchedPage?.cid ? String(matchedPage.cid) : (vd.cid ? String(vd.cid) : undefined)

  return {
    bvid: vd.bvid || target.bvid,
    aid: vd.aid ? String(vd.aid) : target.aid,
    cid: resolvedCid,
    title: vd.title,
    desc: vd.desc,
    coverUrl: ensureHttpsUrl(vd.pic),
    owner: vd.owner?.name
      ? {
          name: vd.owner.name,
          mid: vd.owner.mid,
          face: ensureHttpsUrl(vd.owner.face),
        }
      : undefined,
    stat: vd.stat
      ? {
          view: Number(vd.stat.view ?? 0),
          reply: Number(vd.stat.reply ?? 0),
          favorite: Number(vd.stat.favorite ?? 0),
          like: Number(vd.stat.like ?? 0),
          coin: Number(vd.stat.coin ?? 0),
          share: Number(vd.stat.share ?? 0),
          danmaku: Number(vd.stat.danmaku ?? 0),
          ctime: typeof vd.stat.pubdate === 'number' ? vd.stat.pubdate : undefined,
        }
      : undefined,
  }
}

/**
 * 本次请求真正会出站的 access_key（空串 = 免登录档）。
 *
 * 星之阁 / 米人 是不受我们控制的外部服务。把「用户在页面上粘贴的 B 站登录凭据」
 * 原样转发过去，等于替用户把账号交出去——他以为只是「解锁高清」，实际是把
 * access_key 送进了别人的日志。所以默认只转发**操作者自己配的**
 * `NAVHUB_BILIBILI_ACCESS_KEY`（那是部署者对自己账号的处置），用户提交的 key
 * 要显式 `NAVHUB_BILI_FORWARD_USER_KEY=1` 才允许出站。
 */
export function forwardsUserAccessKey(): boolean {
  return process.env.NAVHUB_BILI_FORWARD_USER_KEY === '1'
}

export function resolveOutboundAccessKey(input: BilibiliHdParseInput): string {
  const operatorKey = (process.env.NAVHUB_BILIBILI_ACCESS_KEY ?? '').trim()
  const userKey = (input.accessKey ?? '').trim()
  if (!userKey) return operatorKey
  return forwardsUserAccessKey() ? userKey : operatorKey
}

/**
 * 缓存按「结果是用哪把凭据解析出来的」分桶。
 *
 * 旧键只分 custom / default 两档：任何两把不同的 access_key 共用同一份结果，
 * 等于把 A 账号解析出的带签名流地址发给 B（那是可用的 Bearer 能力，TTL 到 deadline）。
 * 这里用出站 key 的 SHA-256 摘要前 8 字节分桶——摘要只当键用，不落盘、不进日志。
 * 拿不到 WebCrypto 时返回 null，调用方据此**不缓存**带 key 的请求：
 * 宁可多解析一次，也不能让不同账号的结果互相串。
 */
export async function accessKeyCacheBucket(outboundKey: string): Promise<string | null> {
  const key = outboundKey.trim()
  if (!key) return 'anon'
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(key))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/**
 * 引擎 1 (主引擎)：星之阁 B 站解析 API (https://api.xingzhige.com/doc/40)
 */
export async function parseBilibiliWithXingzhige(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  const accessKey = resolveOutboundAccessKey(input)

  const queryParams = new URLSearchParams()
  queryParams.set('url', target.canonicalUrl)
  if (accessKey) {
    queryParams.set('access_key', accessKey)
  }

  const requestUrl = `${XINGZHIGE_BILI_PARSE_ENDPOINT}?${queryParams.toString()}`

  const res = await fetchImpl(requestUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    throw new Error(`星之阁解析接口返回 HTTP ${res.status}`)
  }

  const json = (await res.json()) as XingzhigeBiliParseRawResponse
  if (!json || json.code !== 0 || !json.data || !json.data.video?.url) {
    throw new Error(json?.msg || `星之阁解析未返回有效直链 (code=${json?.code ?? 'unknown'})`)
  }

  const d = json.data
  const streamUrl = ensureHttpsUrl(d.video?.url)
  if (!streamUrl) {
    throw new Error('星之阁返回的直链为空')
  }

  const resolvedBvid = d.bvid || target.bvid
  const resolvedAid = d.aid !== undefined && d.aid !== null ? String(d.aid) : target.aid
  const resolvedCid = d.cid !== undefined && d.cid !== null ? String(d.cid) : target.cid
  const qualityLabel = d.video?.max_qxd?.trim() || '高清 720P'

  const embedUrl = buildBilibiliEmbedUrl({
    bvid: resolvedBvid,
    aid: resolvedAid,
    cid: resolvedCid,
    p: target.p,
  })

  return {
    ok: true,
    source: 'xingzhige',
    canonicalUrl: target.canonicalUrl,
    bvid: resolvedBvid,
    aid: resolvedAid,
    cid: resolvedCid,
    p: target.p,
    title: d.video?.title?.trim() || undefined,
    desc: d.video?.desc?.trim() || undefined,
    coverUrl: ensureHttpsUrl(d.video?.fm),
    qualityLabel,
    streamUrl,
    proxyStreamUrl: `/api/videos/bili-stream?url=${encodeURIComponent(streamUrl)}`,
    embedUrl,
    owner: d.owner?.name
      ? {
          name: d.owner.name,
          mid: d.owner.mid,
          face: ensureHttpsUrl(d.owner.face),
        }
      : undefined,
    stat: d.stat
      ? {
          view: Number(d.stat.view ?? 0),
          reply: Number(d.stat.reply ?? 0),
          favorite: Number(d.stat.favorite ?? 0),
          like: Number(d.stat.like ?? 0),
          coin: Number(d.stat.coin ?? 0),
          share: Number(d.stat.share ?? 0),
          danmaku: Number(d.stat.danmaku ?? d.stat.danmuku ?? 0),
          ctime: typeof d.stat.ctime === 'number' ? d.stat.ctime : undefined,
          time: d.stat.time,
        }
      : undefined,
    expiresAt: extractStreamExpiresAt(streamUrl),
  }
}

/**
 * 引擎 2 (备用 1)：米人 API (Mir6 bzjiexi - https://api.mir6.com/api/bzjiexi)
 */
export async function parseBilibiliWithMir6(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  const requestUrl = `${MIR6_BILI_PARSE_ENDPOINT}?url=${encodeURIComponent(target.canonicalUrl)}`

  const res = await fetchImpl(requestUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) {
    throw new Error(`米人解析接口返回 HTTP ${res.status}`)
  }

  const json = (await res.json()) as Mir6BiliParseRawResponse
  if (!json || json.code !== 200 || !json.data || !json.data[0]?.video_url) {
    throw new Error(json?.msg || `米人 API 解析未返回有效直链 (code=${json?.code ?? 'unknown'})`)
  }

  const item = json.data[0]
  const rawStreamUrl = item.video_url
  const streamUrl = ensureHttpsUrl(rawStreamUrl)
  if (!streamUrl) {
    throw new Error('米人 API 返回的视频流地址为空')
  }

  const qualityLabel = item.accept?.[0] || '高清 720P'
  const embedUrl = buildBilibiliEmbedUrl({
    bvid: target.bvid,
    aid: target.aid,
    cid: target.cid,
    p: target.p,
  })

  return {
    ok: true,
    source: 'mir6',
    canonicalUrl: target.canonicalUrl,
    bvid: target.bvid,
    aid: target.aid,
    cid: target.cid,
    p: target.p,
    title: json.title?.trim() || item.title?.trim(),
    desc: json.desc?.trim(),
    coverUrl: ensureHttpsUrl(json.imgurl),
    qualityLabel,
    streamUrl,
    proxyStreamUrl: `/api/videos/bili-stream?url=${encodeURIComponent(streamUrl)}`,
    embedUrl,
    owner: json.user?.name
      ? {
          name: json.user.name,
          face: ensureHttpsUrl(json.user.user_img),
        }
      : undefined,
    expiresAt: extractStreamExpiresAt(streamUrl),
  }
}

/**
 * 引擎 3 (备用 2)：B 站官方 WBI 签名高画质 PlayUrl 通道
 */
export async function parseBilibiliWithWbi(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  let bvid = target.bvid
  let aid = target.aid
  let cid = target.cid
  let title: string | undefined
  let desc: string | undefined
  let coverUrl: string | undefined
  let owner: BilibiliHdParsedOwner | undefined
  let stat: BilibiliHdParsedStat | undefined

  if (!cid || (!bvid && !aid)) {
    const meta = await fetchBiliVideoInfo(target, fetchImpl)
    bvid = meta.bvid || bvid
    aid = meta.aid || aid
    cid = meta.cid || cid
    title = meta.title
    desc = meta.desc
    coverUrl = meta.coverUrl
    owner = meta.owner
    stat = meta.stat
  }

  if (!cid) {
    throw new Error('未能解析出视频 cid')
  }

  const mixinKey = await getWbiMixinKey()
  const baseParams: Record<string, string | number> = {
    cid,
    qn: 80,
    platform: 'html5',
    high_quality: 1,
    otype: 'json',
  }
  if (bvid) {
    baseParams.bvid = bvid
  } else if (aid) {
    baseParams.avid = aid
  }

  const query = mixinKey
    ? signWbiQuery(baseParams, mixinKey, Math.floor(Date.now() / 1000)).query
    : new URLSearchParams(Object.entries(baseParams).map(([k, v]) => [k, String(v)])).toString()

  const playRes = await fetchImpl(`https://api.bilibili.com/x/player/wbi/playurl?${query}`, {
    headers: {
      ...BILI_HEADERS,
      'Referer': 'https://www.bilibili.com/',
    },
    signal: AbortSignal.timeout(6000),
  })

  if (!playRes.ok) {
    throw new Error(`B 站 WBI playurl 接口返回 HTTP ${playRes.status}`)
  }

  const playJson = await playRes.json()
  const rawStreamUrl = playJson?.data?.durl?.[0]?.url
  const streamUrl = ensureHttpsUrl(rawStreamUrl)
  if (playJson?.code !== 0 || !streamUrl) {
    throw new Error(playJson?.message || 'B 站 WBI playurl 未返回有效直链')
  }

  const qn = Number(playJson?.data?.quality ?? 64)
  const qualityMap: Record<number, string> = {
    120: '超清 4K',
    116: '高清 1080P60',
    112: '高清 1080P+',
    80: '高清 1080P',
    64: '高清 720P',
    32: '清晰 480P',
    16: '流畅 360P',
  }

  return {
    ok: true,
    source: 'bilibili_wbi',
    canonicalUrl: target.canonicalUrl,
    bvid,
    aid,
    cid,
    p: target.p,
    title,
    desc,
    coverUrl,
    qualityLabel: qualityMap[qn] || '高清 720P',
    streamUrl,
    proxyStreamUrl: `/api/videos/bili-stream?url=${encodeURIComponent(streamUrl)}`,
    embedUrl: buildBilibiliEmbedUrl({ bvid, aid, cid, p: target.p }),
    owner,
    stat,
    expiresAt: extractStreamExpiresAt(streamUrl),
  }
}

/**
 * 引擎 4 (备用 3)：B 站官方原生 Web HTML5 PlayUrl 通道
 */
export async function parseBilibiliWithNativeHtml5(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  let bvid = target.bvid
  let aid = target.aid
  let cid = target.cid
  let title: string | undefined
  let desc: string | undefined
  let coverUrl: string | undefined
  let owner: BilibiliHdParsedOwner | undefined
  let stat: BilibiliHdParsedStat | undefined

  if (!cid || (!bvid && !aid)) {
    const meta = await fetchBiliVideoInfo(target, fetchImpl)
    bvid = meta.bvid || bvid
    aid = meta.aid || aid
    cid = meta.cid || cid
    title = meta.title
    desc = meta.desc
    coverUrl = meta.coverUrl
    owner = meta.owner
    stat = meta.stat
  }

  if (!cid) {
    throw new Error('未能解析出视频 cid')
  }

  const playParams = new URLSearchParams({
    cid,
    qn: '80',
    type: '',
    otype: 'json',
    platform: 'html5',
    high_quality: '1',
  })
  if (bvid) {
    playParams.set('bvid', bvid)
  } else if (aid) {
    playParams.set('avid', aid)
  }

  const playRes = await fetchImpl(`https://api.bilibili.com/x/player/playurl?${playParams.toString()}`, {
    headers: {
      ...BILI_HEADERS,
      'Referer': 'https://www.bilibili.com/',
    },
    signal: AbortSignal.timeout(6000),
  })
  if (!playRes.ok) {
    throw new Error(`B 站 playurl 接口返回 HTTP ${playRes.status}`)
  }

  const playJson = await playRes.json()
  const rawStreamUrl = playJson?.data?.durl?.[0]?.url
  const streamUrl = ensureHttpsUrl(rawStreamUrl)
  if (playJson?.code !== 0 || !streamUrl) {
    throw new Error(playJson?.message || 'B 站 playurl 未返回有效 MP4 地址')
  }

  const qn = Number(playJson?.data?.quality ?? 64)
  const qualityMap: Record<number, string> = {
    120: '超清 4K',
    116: '高清 1080P60',
    112: '高清 1080P+',
    80: '高清 1080P',
    64: '高清 720P',
    32: '清晰 480P',
    16: '流畅 360P',
  }

  return {
    ok: true,
    source: 'bilibili_html5',
    canonicalUrl: target.canonicalUrl,
    bvid,
    aid,
    cid,
    p: target.p,
    title,
    desc,
    coverUrl,
    qualityLabel: qualityMap[qn] || '高清 720P',
    streamUrl,
    proxyStreamUrl: `/api/videos/bili-stream?url=${encodeURIComponent(streamUrl)}`,
    embedUrl: buildBilibiliEmbedUrl({ bvid, aid, cid, p: target.p }),
    owner,
    stat,
    expiresAt: extractStreamExpiresAt(streamUrl),
  }
}

/**
 * 引擎 5 (备用 4)：B 站官方 PC 客户端兼容通道
 */
export async function parseBilibiliWithPc(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  let bvid = target.bvid
  let aid = target.aid
  let cid = target.cid
  let title: string | undefined
  let desc: string | undefined
  let coverUrl: string | undefined
  let owner: BilibiliHdParsedOwner | undefined
  let stat: BilibiliHdParsedStat | undefined

  if (!cid || (!bvid && !aid)) {
    const meta = await fetchBiliVideoInfo(target, fetchImpl)
    bvid = meta.bvid || bvid
    aid = meta.aid || aid
    cid = meta.cid || cid
    title = meta.title
    desc = meta.desc
    coverUrl = meta.coverUrl
    owner = meta.owner
    stat = meta.stat
  }

  if (!cid) {
    throw new Error('未能解析出视频 cid')
  }

  const playParams = new URLSearchParams({
    cid,
    qn: '80',
    platform: 'pc',
    otype: 'json',
  })
  if (bvid) {
    playParams.set('bvid', bvid)
  } else if (aid) {
    playParams.set('avid', aid)
  }

  const playRes = await fetchImpl(`https://api.bilibili.com/x/player/playurl?${playParams.toString()}`, {
    headers: {
      ...BILI_HEADERS,
      'Referer': 'https://www.bilibili.com/',
    },
    signal: AbortSignal.timeout(6000),
  })
  if (!playRes.ok) {
    throw new Error(`B 站 PC playurl 接口返回 HTTP ${playRes.status}`)
  }

  const playJson = await playRes.json()
  const rawStreamUrl = playJson?.data?.durl?.[0]?.url
  const streamUrl = ensureHttpsUrl(rawStreamUrl)
  if (playJson?.code !== 0 || !streamUrl) {
    throw new Error(playJson?.message || 'B 站 PC playurl 未返回有效直链')
  }

  const qn = Number(playJson?.data?.quality ?? 64)
  const qualityMap: Record<number, string> = {
    80: '高清 1080P',
    64: '高清 720P',
    32: '清晰 480P',
    16: '流畅 360P',
  }

  return {
    ok: true,
    source: 'bilibili_pc',
    canonicalUrl: target.canonicalUrl,
    bvid,
    aid,
    cid,
    p: target.p,
    title,
    desc,
    coverUrl,
    qualityLabel: qualityMap[qn] || '高清 720P',
    streamUrl,
    proxyStreamUrl: `/api/videos/bili-stream?url=${encodeURIComponent(streamUrl)}`,
    embedUrl: buildBilibiliEmbedUrl({ bvid, aid, cid, p: target.p }),
    owner,
    stat,
    expiresAt: extractStreamExpiresAt(streamUrl),
  }
}

/**
 * 引擎 6 (备用 5)：B 站官方 Android 客户端移动流通道
 */
export async function parseBilibiliWithAndroid(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  let bvid = target.bvid
  let aid = target.aid
  let cid = target.cid
  let title: string | undefined
  let desc: string | undefined
  let coverUrl: string | undefined
  let owner: BilibiliHdParsedOwner | undefined
  let stat: BilibiliHdParsedStat | undefined

  if (!cid || (!bvid && !aid)) {
    const meta = await fetchBiliVideoInfo(target, fetchImpl)
    bvid = meta.bvid || bvid
    aid = meta.aid || aid
    cid = meta.cid || cid
    title = meta.title
    desc = meta.desc
    coverUrl = meta.coverUrl
    owner = meta.owner
    stat = meta.stat
  }

  if (!cid) {
    throw new Error('未能解析出视频 cid')
  }

  const playParams = new URLSearchParams({
    cid,
    qn: '64',
    platform: 'android',
    otype: 'json',
  })
  if (bvid) {
    playParams.set('bvid', bvid)
  } else if (aid) {
    playParams.set('avid', aid)
  }

  const playRes = await fetchImpl(`https://api.bilibili.com/x/player/playurl?${playParams.toString()}`, {
    headers: {
      ...BILI_HEADERS,
      'User-Agent': 'Bilibili/7.50.0 (Android; Mobile)',
      'Referer': 'https://www.bilibili.com/',
    },
    signal: AbortSignal.timeout(6000),
  })
  if (!playRes.ok) {
    throw new Error(`B 站 Android playurl 接口返回 HTTP ${playRes.status}`)
  }

  const playJson = await playRes.json()
  const rawStreamUrl = playJson?.data?.durl?.[0]?.url
  const streamUrl = ensureHttpsUrl(rawStreamUrl)
  if (playJson?.code !== 0 || !streamUrl) {
    throw new Error(playJson?.message || 'B 站 Android playurl 未返回有效直链')
  }

  return {
    ok: true,
    source: 'bilibili_android',
    canonicalUrl: target.canonicalUrl,
    bvid,
    aid,
    cid,
    p: target.p,
    title,
    desc,
    coverUrl,
    qualityLabel: '高清 720P',
    streamUrl,
    proxyStreamUrl: `/api/videos/bili-stream?url=${encodeURIComponent(streamUrl)}`,
    embedUrl: buildBilibiliEmbedUrl({ bvid, aid, cid, p: target.p }),
    owner,
    stat,
    expiresAt: extractStreamExpiresAt(streamUrl),
  }
}

/**
 * 统一多引擎自动容灾解析入口（合规倒置后的优先级）：
 *   按优先级依次尝试解析引擎，遇失败自动顺延切换：
 *     1. 官方 WBI 签名通道 (Bilibili WBI - Primary)
 *     2. 官方免登录 Web HTML5 通道 (Bilibili HTML5)
 *     3. 官方 PC 客户端通道 (Bilibili PC)
 *     4. 官方 Android 客户端通道 (Bilibili Android)
 *     5. 第三方兜底：星之阁 API (Xingzhige)
 *     6. 第三方兜底：米人 API (Mir6)
 *     7. 终极内嵌兜底 (Bilibili Iframe Embed Fallback)
 */
export async function resolveBilibiliHdStream(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  const userKey = (input.accessKey ?? '').trim()
  const outboundKey = resolveOutboundAccessKey(input)
  // 用户填了 key，但真正出站的不是它 = 本部署拦下了转发。界面必须说出来。
  const accessKeyIgnored = Boolean(userKey) && outboundKey !== userKey
  // 缓存桶按「真正出站的那把 key」分。用户 key 被拦下时结果属于操作者档，
  // 不能和用户 key 的结果共用一个桶——否则就是把 A 账号的签名流地址发给 B。
  // bucket 为 null 表示环境没有 WebCrypto：带 key 的请求一律不缓存，
  // 宁可多解析一次，也不能让不同账号的结果互相串味。
  const bucket = await accessKeyCacheBucket(outboundKey)
  const cacheKey = bucket === null
    ? null
    : `${target.canonicalUrl}|p=${target.p}|key=${bucket}|pref=${input.preferredEngine || 'auto'}`

  if (!input.forceRefresh && cacheKey) {
    const cached = streamCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return withKeyNotice(cached, accessKeyIgnored)
    }
  }

  /**
   * 引擎优先级（升级方案 3.3 合规倒置）：**官方通道优先，第三方只做末位兜底**。
   *
   * 历史顺序是星之阁/米人两个不受控第三方打头阵——每次解析都先把目标 URL 交给
   * 外部服务（隐私 + 断供 + ToS 风险），官方通道反而成了摆设。官方 WBI/HTML5/PC/
   * Android 通道直接与 B 站 API 通信（access_key 出站策略不变），失败时才顺延到
   * 第三方；部署方可用 `NAVHUB_BILI_DISABLE_THIRD_PARTY=1` 彻底关掉第三方出站。
   * 官方通道集体被风控时，第三方兜底仍能救回可用性。
   */
  const allEngines: Array<{
    name: BilibiliParseEngineSource
    fn: (inp: BilibiliHdParseInput, f: typeof fetch) => Promise<BilibiliHdParseResult>
  }> = [
    { name: 'bilibili_wbi', fn: parseBilibiliWithWbi },
    { name: 'bilibili_html5', fn: parseBilibiliWithNativeHtml5 },
    { name: 'bilibili_pc', fn: parseBilibiliWithPc },
    { name: 'bilibili_android', fn: parseBilibiliWithAndroid },
    { name: 'xingzhige', fn: parseBilibiliWithXingzhige },
    { name: 'mir6', fn: parseBilibiliWithMir6 },
  ]

  const disableThirdParty = process.env.NAVHUB_BILI_DISABLE_THIRD_PARTY === '1'
  const engines = disableThirdParty
    ? allEngines.filter(e => e.name !== 'xingzhige' && e.name !== 'mir6')
    : allEngines

  // 如果指定了优先引擎，将该引擎提至最前
  if (input.preferredEngine && input.preferredEngine !== 'iframe_fallback') {
    const idx = engines.findIndex(e => e.name === input.preferredEngine)
    if (idx > 0) {
      const [chosen] = engines.splice(idx, 1)
      if (chosen) engines.unshift(chosen)
    }
  }

  const failedErrors: string[] = []

  for (const engine of engines) {
    try {
      const res = await engine.fn(input, fetchImpl)
      if (res.ok && res.streamUrl) {
        // 落缓存的是「纯解析结果」：accessKeyIgnored 是每次请求按当时配置算出来的，
        // 存进去会把一次性的策略状态固化成别人读到的结果。
        const stored: BilibiliHdParseResult = { ...res }
        delete stored.accessKeyIgnored
        if (cacheKey) saveToStreamCache(cacheKey, stored)
        return withKeyNotice(stored, accessKeyIgnored)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      failedErrors.push(`${engine.name}: ${errMsg}`)
    }
  }

  // 全部 6 个解析引擎均失败时，优雅降级为官方高画质内嵌播放器
  const embedUrl = buildBilibiliEmbedUrl({
    bvid: target.bvid,
    aid: target.aid,
    cid: target.cid,
    p: target.p,
  })

  return withKeyNotice(
    {
      ok: false,
      source: 'iframe_fallback',
      canonicalUrl: target.canonicalUrl,
      bvid: target.bvid,
      aid: target.aid,
      cid: target.cid,
      p: target.p,
      qualityLabel: '官方内嵌播放',
      embedUrl,
      expiresAt: Date.now() + 60_000,
      errorReason: `6 大解析引擎全部熔断失败: ${failedErrors.join(' | ')}`,
    },
    accessKeyIgnored,
  )
}

/** 只在「确实被拦下」时补标记，免得每条正常结果都挂一个 `false` 字段 */
function withKeyNotice(result: BilibiliHdParseResult, accessKeyIgnored: boolean): BilibiliHdParseResult {
  if (!accessKeyIgnored) return result
  return { ...result, accessKeyIgnored: true }
}

function saveToStreamCache(key: string, value: BilibiliHdParseResult): void {
  if (streamCache.size >= STREAM_CACHE_MAX_SIZE) {
    const firstKey = streamCache.keys().next().value
    if (firstKey) {
      streamCache.delete(firstKey)
    }
  }
  streamCache.set(key, value)
}

export function clearBilibiliHdStreamCache(): void {
  streamCache.clear()
}
