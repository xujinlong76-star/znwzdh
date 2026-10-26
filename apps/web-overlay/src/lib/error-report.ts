/**
 * 崩溃页面的「翻译层」：把异常翻译成用户能据此行动的一句话。
 *
 * 背景（真实用户痛点）：之前的 `app/error.tsx` 把 `error.message` 直接当成
 * 正文展示——生产环境里那通常是 `Minified React error #418`、`ChunkLoadError`
 * 这类英文内部信息。用户看到的是「页面渲染遇到错误」+ 一行看不懂的字，
 * 既不知道是不是自己操作错了，也不知道该做什么；反馈时也只会说「坏了」，
 * 因为页面上没有任何可用于定位的编号。
 *
 * 这里把「异常 → 该怎么办」的判定抽成纯函数（可单测），组件只负责渲染：
 *   - 分类：资源分块（发版瞬间最常见）/ 网络 / 水合不一致 / 本机存储满 / 真运行时异常；
 *   - 说明：每类都给出「这是什么 + 现在该做什么」；
 *   - 定位：透出 Next 的 digest（服务端错误的唯一可对应编号），
 *     并过滤掉对用户毫无意义的 detail（如压缩后的 React 错误），
 *     让「可复制的反馈信息」真的有信息量。
 */

/** 崩溃分类。命名即结论，组件据此选文案。 */
export type CrashKind = 'chunk' | 'network' | 'hydration' | 'storage' | 'runtime'

export interface CrashInfo {
  kind: CrashKind
  /** 顶部小标签 */
  badge: string
  title: string
  /** 「发生了什么 + 现在该做什么」 */
  hint: string
  /** 原始异常信息；对用户无意义时为 undefined（不要拿压缩错误当正文） */
  detail?: string
  /** 可与服务端日志对应的编号；没有则 undefined */
  digest?: string
  /** 「重新加载」是否有可能解决（存储满之类重试没用） */
  retryable: boolean
}

function rawMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') return error.message.trim()
  if (typeof error === 'string') return error.trim()
  if (typeof error === 'object' && error !== null) {
    const m = (error as { message?: unknown }).message
    if (typeof m === 'string') return m.trim()
  }
  return ''
}

/** 压缩后的 React 错误对用户零信息量（要的是「刷新一下」，不是这行字） */
function isUselessDetail(message: string): boolean {
  if (!message) return true
  return /^Minified React error/i.test(message) || /^error #\d+/i.test(message)
}

export function classifyCrash(message: string): CrashKind {
  if (/ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to load chunk/i.test(message)) return 'chunk'
  if (/Failed to fetch|NetworkError|Load failed|Network request failed|net::ERR|ERR_NETWORK/i.test(message)) {
    return 'network'
  }
  if (/hydrat|Text content does not match|server-rendered HTML/i.test(message)) return 'hydration'
  if (/QuotaExceededError|exceeded the quota/i.test(message)) return 'storage'
  return 'runtime'
}

/**
 * 异常 → 崩溃页文案。
 *
 * `digest` 由 Next 注入（服务端渲染失败时才有），是用户唯一能拿去对应的编号，
 * 有就一定要露出来；`retryable=false` 的分类（如本机存储满）不给重试按钮，
 * 免得用户按一个按了也没用的按钮。
 */
export function describeCrash(error: unknown, digest?: string): CrashInfo {
  const message = rawMessage(error)
  const kind = classifyCrash(message)
  const id = typeof digest === 'string' && digest.trim() ? digest.trim() : undefined

  const base = { kind, digest: id }

  switch (kind) {
    case 'chunk':
      return {
        ...base,
        badge: '资源加载失败',
        title: '页面资源已更新',
        hint: '站点刚发布过新版本，当前页面还在用旧资源。点「重新加载」即可拿到新版页面。',
        detail: message || undefined,
        retryable: true,
      }
    case 'network':
      return {
        ...base,
        badge: '网络请求失败',
        title: '网络请求没有成功',
        hint: '请先确认网络连接正常；若网络没问题，可能是数据中枢暂时不可达，稍后重试通常即可恢复。',
        detail: message || undefined,
        retryable: true,
      }
    case 'hydration':
      return {
        ...base,
        badge: '页面状态不一致',
        title: '页面与数据不一致',
        hint: '页面刚更新过，或数据在渲染途中发生了变化。重新加载即可恢复，你的收藏等本地数据不受影响。',
        detail: undefined,
        retryable: true,
      }
    case 'storage':
      return {
        ...base,
        badge: '本机存储已满',
        title: '浏览器本地存储空间不足',
        hint: '收藏、偏好等本地数据可能无法保存。可清理该站点的浏览器数据后重试；云端收藏不受影响。',
        detail: message || undefined,
        retryable: false,
      }
    default:
      return {
        ...base,
        badge: '运行时异常',
        title: '页面渲染遇到错误',
        hint: '重新加载通常可以恢复。若反复出现，请把下面的编号与详情一并反馈，便于定位。',
        detail: isUselessDetail(message) ? undefined : message,
        retryable: true,
      }
  }
}

/** 拼出一段可直接粘贴到反馈里的诊断文本（不含任何隐私数据） */
export function crashReportText(info: CrashInfo): string {
  const lines = ['[山羊胡崩溃反馈]', '类型：' + info.badge, '说明：' + info.title]
  if (info.digest) lines.push('编号：' + info.digest)
  if (info.detail) lines.push('详情：' + info.detail)
  // SSR / 测试环境下没有 window，就不写空行
  if (typeof window !== 'undefined' && window.location?.href) lines.push('页面：' + window.location.href)
  lines.push('时间：' + new Date().toISOString())
  return lines.join('\n')
}
