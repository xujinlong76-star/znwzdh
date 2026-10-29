/**
 * B 站视频标识 / 播放地址的纯函数与类型（浏览器端可安全 import）。
 *
 * 为什么单独一个文件：`video-bilibili-hd-parser.ts` 顶层 import 了 `bilibili-wbi`
 * （用 node:crypto 做 wbi 签名），只能在服务端引用。而 `'use client'` 的播放器组件
 * 只需要「规范化输入 / 拼内嵌播放地址」这两件纯计算，却会顺着 import 链把
 * node:crypto 一起拖进客户端图（node 内建 polyfill 会实打实进首屏）。
 * parser 仍原样再导出这些符号，服务端调用点与既有测试都不用改。
 */

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
