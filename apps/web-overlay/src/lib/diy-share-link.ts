/**
 * `#diy=` 免登分享链接的编码。
 *
 * 为什么单独抽成一个纯模块：编码失败的原因（循环引用、BigInt、落单的代理项）
 * 都必须能复现、能断言；而调用它的 useCallback 在 node 环境跑不起来
 * （仓库的 vitest 没有 jsdom，也没装 @testing-library/react）。
 * 抽出来之后成功与失败两条路都能拿真实输入测。
 *
 * 关键约定：失败**不返回空串**。空串会被调用方当成「没什么可分享的」，
 * 于是静默吞掉 —— 原来的 `if (!url) return` 就是这个后果：用户点了分享，
 * 界面毫无反应，只能以为按钮坏了。
 */

import { validateAndCleanDIYConfig } from '@/lib/modular/diy-presets'
import {
  DIY_SHARE_FIELD_NAMES,
  buildVersionedSharePayload,
  type DiyShareEnvelope,
} from '@/lib/modular/diy-layout-schema'
import type { HomeDIYConfig } from '@/lib/modular/home-diy-storage'

/** 分享链接的页面基准（只取编码需要的两段，便于纯函数测试） */
export interface ShareLinkBase {
  origin: string
  pathname: string
}

export type ShareLinkOutcome = { ok: true; url: string } | { ok: false; reason: string }

/** 与导入侧（applyHomeDiyShareHash）的 4KB 上限对齐 */
export const SHARE_LINK_MAX_BYTES = 4096

/**
 * 把配置负载编码成 `<origin><pathname>#diy=<base64>`。
 *
 * 两种失败都返回原因，交给调用方展示：
 *   - 序列化/编码抛错（循环引用、BigInt、落单代理项）；
 *   - 编码结果超过 4KB —— 导入侧会直接丢弃，与其让好友打开链接后一脸茫然，
 *     不如在**生成**这一侧就说清楚「太长，请改用复制配置」。
 */
export function encodeShareLink(payload: unknown, base: ShareLinkBase): ShareLinkOutcome {
  if (!base || typeof base.origin !== 'string' || typeof base.pathname !== 'string') {
    return { ok: false, reason: '当前页面地址不完整，没法生成分享链接' }
  }

  let json: string
  try {
    json = JSON.stringify(payload)
  } catch (error) {
    return { ok: false, reason: describeShareLinkFailure(error) }
  }
  if (typeof json !== 'string') {
    // JSON.stringify(undefined) / 函数 → undefined，不是字符串
    return {
      ok: false,
      reason: describeShareLinkFailure(new TypeError('payload is not serializable')),
    }
  }

  let b64: string
  try {
    b64 = btoa(encodeURIComponent(json))
  } catch (error) {
    return { ok: false, reason: describeShareLinkFailure(error) }
  }

  if (b64.length > SHARE_LINK_MAX_BYTES) {
    return {
      ok: false,
      reason: '排版内容太长，超过分享链接 4KB 上限，请改用「复制配置」',
    }
  }

  return { ok: true, url: `${base.origin}${base.pathname}#diy=${b64}` }
}

/** 失败原因 → 一句能给用户看的话（不暴露堆栈） */
export function describeShareLinkFailure(error: unknown): string {
  return error instanceof TypeError
    ? '排版配置里有无法序列化的内容（比如循环引用），没法生成分享链接，请改用「复制配置」'
    : '排版配置没能编码成分享链接，请改用「复制配置」'
}

/* ------------------------------------------------------------------ *
 * 解码侧（新格式 v1 + 旧格式 legacy 双读）
 * ------------------------------------------------------------------ */

/** `#diy=` hash 解码：只负责 base64 → JSON，不管里面的字段长什么样 */
export type DecodedSharePayload =
  | { ok: true; raw: unknown }
  | { ok: false; reason: string }

export function decodeShareLinkPayload(hash: string): DecodedSharePayload {
  const b64 = typeof hash === 'string' && hash.startsWith('#diy=') ? hash.slice('#diy='.length) : hash
  if (!b64) return { ok: false, reason: '分享链接里没有排版内容' }
  // 长度上限 4KB：与 SHARE_LINK_MAX_BYTES 同口径（live 解码与编码共用）
  if (b64.length > SHARE_LINK_MAX_BYTES) {
    return { ok: false, reason: '分享链接超过 4KB 上限，已整条忽略，沿用本地排版。' }
  }
  let json: string
  try {
    json = decodeURIComponent(atob(b64))
  } catch {
    return { ok: false, reason: '分享链接解析失败，已沿用本地排版。' }
  }
  if (json.length > SHARE_LINK_MAX_BYTES) {
    return { ok: false, reason: '分享链接超过 4KB 上限，已整条忽略，沿用本地排版。' }
  }
  try {
    return { ok: true, raw: JSON.parse(json) }
  } catch {
    return { ok: false, reason: '分享链接解析失败，已沿用本地排版。' }
  }
}

export interface ParsedSharePayload {
  ok: boolean
  /** 清洗后的全量配置（默认值已补齐；失败时不带） */
  config?: HomeDIYConfig
  /** 'v1' = 新信封 { diy: 1, config }；'legacy' = 旧裸配置（短/长字段都认） */
  format?: 'v1' | 'legacy'
  /** 链接实际携带的分享字段（只含 11 个可分享字段，供字段级合并与差异预览） */
  carriedFields?: string[]
  /** 两层台账合计：结构层吃掉的 + 清洗器吃掉的 */
  dropped: number
  notes: string[]
  /** 非空 = 链接里有内容被吃掉，接收方必须在确认前看到（与 storage 的 warning 同文案） */
  warning: string | null
  error?: string
}

/**
 * 分享载荷解析：结构层（sanitizeDiyLayoutInput）+ 条目层（validateAndCleanDIYConfig）。
 *
 * 异步原因：结构层住在 zod 模块（diy-layout-schema-zod.ts），zod 约 103 KB，
 * 静态 import 会进首页首屏 —— 本函数只在打开分享链接 / 确认导入时才跑，
 * 所以这里 dynamic import，调用方 await。encodeVersionedShareLink 不走 zod，
 * 仍是同步的。
 *
 * 兼容承诺：旧 #diy= 链接（短字段 + `v: 3`、或长字段）永久可读 ——
 * 没有 `diy` 键的一律按 legacy 读，短字段展开、清洗口径与今天的
 * applyHomeDiyShareHash 完全一致；新格式只多认一个 `{ diy: 1, config }` 信封。
 * applyHomeDiyShareHash（home-diy-storage.ts）是唯一的 live 解码入口，
 * 它经 decodeShareLinkPayload + 本函数解析，storage 里不再留内联展开/清洗。
 */
export async function parseSharePayload(raw: unknown): Promise<ParsedSharePayload> {
  const { sanitizeDiyLayoutInput } = await import('@/lib/modular/diy-layout-schema-zod')
  const sanitized = sanitizeDiyLayoutInput(raw)
  if (!sanitized.ok || !sanitized.config) {
    return { ok: false, dropped: 0, notes: [], warning: null, error: sanitized.error ?? '分享链接内容不合法' }
  }
  const carriedFields = sanitized.carriedFields.filter((f): f is (typeof DIY_SHARE_FIELD_NAMES)[number] =>
    (DIY_SHARE_FIELD_NAMES as readonly string[]).includes(f),
  )
  // 字段级分享可以不带 viewMode（例如只分享背景 + 强调色）：清洗器会因
  // 「缺 viewMode/version」拒收整条链接。分享载荷本身就是 v3 格式，携带了
  // 任一可分享字段时补 version: 3 让它通过元数据校验；一个字段都没带的
  // 链接不补，仍按原口径校验失败（与旧 live 解码器同口径）。
  const configForClean =
    carriedFields.length > 0 &&
    typeof sanitized.config.viewMode !== 'string' &&
    typeof sanitized.config.version !== 'number'
      ? { ...sanitized.config, version: 3 }
      : sanitized.config
  const check = validateAndCleanDIYConfig(configForClean)
  if (!check.valid || !check.config) {
    return {
      ok: false,
      dropped: sanitized.dropped,
      notes: [...sanitized.notes, ...check.notes],
      warning: null,
      error: check.error ?? '分享链接内容不合法',
    }
  }
  const dropped = sanitized.dropped + check.dropped
  const notes = [...sanitized.notes, ...check.notes]
  let warning: string | null = null
  if (notes.length > 0) {
    const head = dropped > 0 ? `${dropped} 项内容被丢弃或截断` : '部分设置值不在支持列表，已回退默认'
    const shown = notes.slice(0, 3).join('；')
    const more = notes.length > 3 ? ` 等 ${notes.length} 项` : ''
    warning = `分享链接待你确认，但${head}：${shown}${more}`
  }
  return {
    ok: true,
    config: check.config as HomeDIYConfig,
    // sanitize ok:true 时 format 一定不是 null；?? undefined 只是过类型。
    format: sanitized.format ?? undefined,
    carriedFields: [...carriedFields],
    dropped,
    notes,
    warning,
  }
}

/**
 * 新格式分享链接编码：`{ diy: 1, config: <11 个可分享字段，长字段名> }`。
 * 旧格式编码器 encodeShareLink 不动（仍是通用编码）；hook 的
 * exportPresetToUrlHash 已切到这里。
 */
export function encodeVersionedShareLink(config: HomeDIYConfig, base: ShareLinkBase): ShareLinkOutcome {
  const envelope: DiyShareEnvelope = buildVersionedSharePayload(config)
  return encodeShareLink(envelope, base)
}
