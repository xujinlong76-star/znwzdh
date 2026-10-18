'use client'

/**
 * 前端错误上报（P2-5 前端一半）。
 *
 * 错误边界（`app/error.tsx` / `global-error.tsx` / `components/route-error.tsx`）
 * 已经把崩溃翻译成用户看得懂的文案，但**服务端一直看不到**：发版后出现
 * ChunkLoadError，运营只能等用户反馈。这里把「已分类的崩溃」脱敏后送到中枢。
 *
 * 隐私设计（为什么发指纹而不发原文）：
 *   - 错误消息里可能夹带用户输入（如表单内容、URL query）；
 *   - 去重与关联只需要一个稳定指纹，不需要原文；
 *   - 因此这里发：kind（前端已分类）+ 12 位消息指纹 + pathname + digest，
 *     **不发错误原文、不发 query、不发身份**。
 *
 * 开关：`NEXT_PUBLIC_ERROR_REPORT=1` 启用（与 RUM 一致的隐私默认值：
 * 默认关闭，个人部署不会把任何数据发到中枢）。
 * 落点：POST /api/hub/api/errors → 中枢 events 表（kind=client_error）
 *       + 进程内聚合 → 后台「前端错误」卡片。
 */
import { classifyCrash, type CrashKind } from '@/lib/error-report'

const ENDPOINT = '/api/hub/api/errors'
const ENABLED = process.env.NEXT_PUBLIC_ERROR_REPORT === '1'

/** 会话内已上报的键（kind|指纹），同一标签页不重复打扰服务端 */
const sent = new Set<string>()

/**
 * 消息指纹：FNV-1a（两个不同种子各算一遍，拼成 12 位十六进制）。
 *
 * 为什么不用 crypto.subtle：它是异步的，而发送走 sendBeacon（同步组包）；
 * 为一个去重指纹引入 await 不值得。FNV-1a 分布对「同类消息串」足够区分。
 * 归一化：压缩连续空白 + 去首尾，避免同一条错误因换行/缩进产生不同指纹。
 */
export function fingerprint(message: string): string {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim()
  const hex = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return (hex(0x811c9dc5) + hex(0x9e3779b9)).slice(0, 12)
}

export interface ClientErrorReport {
  kind: CrashKind
  fingerprint: string
  /** pathname only（不含 query） */
  path?: string
  digest?: string
}

/** 组装上报体（纯函数：可单测「到底发了什么」） */
export function buildErrorReport(input: {
  message: string
  digest?: string
  pathname?: string
}): ClientErrorReport {
  const report: ClientErrorReport = { kind: classifyCrash(input.message), fingerprint: fingerprint(input.message) }
  if (input.pathname) report.path = input.pathname.split('?')[0].slice(0, 200)
  if (input.digest) report.digest = input.digest.slice(0, 64)
  return report
}

/**
 * 上报一条客户端错误（失静默默败）。
 *
 * @param message 原始错误消息（只用于本地分类与指纹，**不会离开浏览器**）
 * @param digest  Next 的错误编号（ production 无 source map 时的定位线索）
 */
export function reportClientError(input: { message: string; digest?: string }): void {
  if (!ENABLED) return
  if (typeof window === 'undefined') return
  const pathname = window.location?.pathname
  const report = buildErrorReport({ message: input.message, digest: input.digest, pathname })
  const key = `${report.kind}|${report.fingerprint}`
  if (sent.has(key)) return
  sent.add(key)

  const body = JSON.stringify(report)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
      return
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* 上报失败绝不能反噬用户：错误边界已经接管界面，遥测丢一条无代价 */
      undefined
    })
  } catch {
    // 上报失败绝不影响用户：错误边界已经接管了界面
  }
}

/** 测试用：清空会话去重集合 */
export function __resetClientErrorDedup(): void {
  sent.clear()
}
