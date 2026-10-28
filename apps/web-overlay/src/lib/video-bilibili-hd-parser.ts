/**
 * Bilibili 高清视频流解析器（支持星之阁 API + 5 大备用解析接口集群自动故障转移）
 *
 * 备用接口集群：
 *   1. 主引擎：星之阁 API (https://api.xingzhige.com/doc/40)
 *   2. 备用 1：米人 API (https://api.mir6.com/api/bzjiexi) —— 免费第三方高可用解析
 *   3. 备用 2：B 站官方 WBI 签名高画质 PlayUrl 通道 —— 防风控能力最强
 *   4. 备用 3：B 站官方免登录 Web HTML5 720P 直连通道
 *   5. 备用 4：B 站官方 PC 客户端兼容 PlayUrl 通道
 *   6. 备用 5：B 站官方 Android 客户端移动流通道
 *   7. 终极兜底：B 站官方高画质内嵌播放器 (player.bilibili.com/player.html?high_quality=1)
 */

import { getWbiMixinKey, signWbiQuery, BILI_HEADERS } from '@/lib/bilibili-wbi'

export const XINGZHIGE_BILI_PARSE_ENDPOINT = 'https://api.xingzhige.com/API/b_parse/'
export const MIR6_BILI_PARSE_ENDPOINT = 'https://api.mir6.com/api/bzjiexi'

export type BilibiliParseEngineSource =
  | 'xingzhige'
  | 'mir6'
  | 'bilibili_wbi'
  | 'bilibili_html5'
  | 'bilibili_pc'
  | 'bilibili_android'
  | 'iframe_fallback'

export interface BilibiliHdParseInput {
  /** 完整 B 站视频链接，或包含 BV/av 号的任意字符串 */
  url?: string
  /** BV 号，例如 BV1MmUSB5Efw */
  bvid?: string
  /** av 数字编号，例如 115609228544903 */
  aid?: string | number
  /** cid 分P编号（可选，用于官方 HTML5 兜底流） */
  cid?: string | number
  /** 分P序号，从 1 开始 */
  p?: number
  /** B 站客户端 access_key（可选，用于解锁 1080P+/大会员画质） */
  accessKey?: string
  /** 是否跳过内存缓存强制重新解析 */
  forceRefresh?: boolean
  /** 指定优先使用的解析引擎（选填，用于调试或手动换源） */
  preferredEngine?: BilibiliParseEngineSource
}

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
 * 将可能以 `http://` 或 `//` 开头的资源地址统一升级为 `https://`，消除浏览器 Mixed Content 告警
 */
export function ensureHttpsUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined
  const trimmed = rawUrl.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`
  }
  if (trimmed.startsWith('http://')) {
    return `https://${trimmed.slice('http://'.length)}`
  }
  return trimmed
}

/**
 * 从任意输入中提取 BV 号、av 号与分 P 序号，并规范化为完整 Bilibili URL。
 */
export function normalizeBilibiliTarget(input: BilibiliHdParseInput): {
  canonicalUrl: string
  bvid?: string
  aid?: string
  cid?: string
  p: number
} {
  let bvid = input.bvid?.trim()
  let aid = input.aid !== undefined && input.aid !== null ? String(input.aid).trim() : undefined
  const cid = input.cid !== undefined && input.cid !== null ? String(input.cid).trim() : undefined
  let p = typeof input.p === 'number' && Number.isFinite(input.p) && input.p >= 1 ? Math.floor(input.p) : 1

  const rawUrl = input.url?.trim() || ''

  if (rawUrl) {
    const bvMatch = rawUrl.match(/BV[a-zA-Z0-9]{10}/i)
    if (bvMatch && !bvid) {
      bvid = bvMatch[0]
    }
    const avMatch = rawUrl.match(/(?:\/av|^av)(\d+)/i)
    if (avMatch && avMatch[1] && !aid) {
      aid = avMatch[1]
    }
    const pMatch = rawUrl.match(/[?&]p=(\d+)/i)
    if (pMatch && pMatch[1] && input.p === undefined) {
      const parsedP = Number.parseInt(pMatch[1], 10)
      if (Number.isFinite(parsedP) && parsedP >= 1) {
        p = parsedP
      }
    }
  }

  if (bvid && /^\d+$/.test(bvid) && !aid) {
    aid = bvid
    bvid = undefined
  }

  if (bvid && /^bv[a-zA-Z0-9]{10}$/.test(bvid)) {
    bvid = `BV${bvid.slice(2)}`
  }

  if (aid) {
    aid = aid.replace(/^av/i, '')
  }

  let baseUrl = ''
  if (bvid) {
    baseUrl = `https://www.bilibili.com/video/${bvid}`
  } else if (aid && /^\d+$/.test(aid)) {
    baseUrl = `https://www.bilibili.com/video/av${aid}`
  } else if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    baseUrl = ensureHttpsUrl(rawUrl) || rawUrl
  } else if (rawUrl) {
    baseUrl = `https://www.bilibili.com/video/${rawUrl}`
  }

  if (!baseUrl) {
    throw new Error('缺少有效的 B 站视频标识（bvid / aid / url）')
  }

  const canonicalUrl = p > 1
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}p=${p}`
    : baseUrl

  return {
    canonicalUrl,
    bvid: bvid || undefined,
    aid: aid || undefined,
    cid: cid || undefined,
    p,
  }
}

/**
 * 构造 B 站官方高画质内嵌播放器地址（始终使用 https:// 协议并开启 high_quality=1）
 */
export function buildBilibiliEmbedUrl(options: {
  bvid?: string
  aid?: string
  cid?: string
  p?: number
  autoplay?: boolean
  seekSec?: number | null
}): string {
  const { bvid, aid, cid, p = 1, autoplay = true, seekSec } = options
  const params = new URLSearchParams()
  params.set('isOutside', 'true')
  params.set('p', String(Math.max(1, Math.floor(p))))
  params.set('autoplay', autoplay ? '1' : '0')
  params.set('high_quality', '1')
  params.set('danmaku', '0')

  if (bvid) {
    params.set('bvid', bvid)
  } else if (aid) {
    params.set('aid', aid)
  }
  if (cid) {
    params.set('cid', cid)
  }
  if (typeof seekSec === 'number' && Number.isFinite(seekSec) && seekSec > 0) {
    params.set('t', String(Math.floor(seekSec)))
  }

  return `https://player.bilibili.com/player.html?${params.toString()}`
}

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
 * 引擎 1 (主引擎)：星之阁 B 站解析 API (https://api.xingzhige.com/doc/40)
 */
export async function parseBilibiliWithXingzhige(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  const accessKey = (input.accessKey ?? process.env.NAVHUB_BILIBILI_ACCESS_KEY ?? '').trim()

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
 * 统一多引擎自动容灾解析入口：
 *   按优先级依次尝试解析引擎，遇失败自动顺延切换：
 *     1. 星之阁 API (Primary)
 *     2. 米人 API (Mir6 - Backup 1)
 *     3. 官方 WBI 签名通道 (Bilibili WBI - Backup 2)
 *     4. 官方免登录 Web HTML5 通道 (Bilibili HTML5 - Backup 3)
 *     5. 官方 PC 客户端通道 (Bilibili PC - Backup 4)
 *     6. 官方 Android 客户端通道 (Bilibili Android - Backup 5)
 *     7. 终极内嵌兜底 (Bilibili Iframe Embed Fallback)
 */
export async function resolveBilibiliHdStream(
  input: BilibiliHdParseInput,
  fetchImpl: typeof fetch = fetch
): Promise<BilibiliHdParseResult> {
  const target = normalizeBilibiliTarget(input)
  const hasCustomKey = Boolean((input.accessKey ?? '').trim())
  const cacheKey = `${target.canonicalUrl}|p=${target.p}|key=${hasCustomKey ? 'custom' : 'default'}|pref=${input.preferredEngine || 'auto'}`

  if (!input.forceRefresh) {
    const cached = streamCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached
    }
  }

  const engines: Array<{
    name: BilibiliParseEngineSource
    fn: (inp: BilibiliHdParseInput, f: typeof fetch) => Promise<BilibiliHdParseResult>
  }> = [
    { name: 'xingzhige', fn: parseBilibiliWithXingzhige },
    { name: 'mir6', fn: parseBilibiliWithMir6 },
    { name: 'bilibili_wbi', fn: parseBilibiliWithWbi },
    { name: 'bilibili_html5', fn: parseBilibiliWithNativeHtml5 },
    { name: 'bilibili_pc', fn: parseBilibiliWithPc },
    { name: 'bilibili_android', fn: parseBilibiliWithAndroid },
  ]

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
        saveToStreamCache(cacheKey, res)
        return res
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

  return {
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
  }
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
