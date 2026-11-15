/**
 * 链接包（快照版）：把多选的收藏打包成一页可分享的清单。
 *
 * 痛点：想把「一套资料/工具合集」发给别人，只能一条条复制链接，对方收到
 * 的是一堆散链接，还得一个个点开。
 *
 * 形态选定（盘点结论，见本文件头注释与测试）：
 *   - 复用 DIY `#diy=` 的分享思路（免登 hash 编码链接 + 版本化信封），
 *     但新开 `#pack=`：载荷形状、解码入口、展示页都与 DIY 排版不同，
 *     共用一个 hash 前缀会让两边解码器互相误读，所以各走各的前缀。
 *   - 编码不用 DIY 的 `btoa(encodeURIComponent(json))`：中文在
 *     encodeURIComponent 下一个字变 9 个字符，标题/用途全是中文的包
 *     很容易顶满 4KB；新 scheme 没有历史兼容负担，直接用 UTF-8 字节
 *     → base64url（一个汉字 3 字节 → 4 个 base64 字符，省约一半）。
 *   - 上限两道闸，与 DIY 同口径：编码后 ≤ 4096 字符（浏览器/微信等
 *     常见上限内，DIY 分享链接同为 4KB）+ 条数 ≤ 20 条；超限生成侧
 *     拒绝并明说分包，不生成一条对方打不开的链接。
 *   - 快照版：生成时把标题/链接/用途拷贝进信封，之后原收藏增删改都
 *     不影响已发出的包；接收页明确标注「快照版，发布于某日，内容不再更新」。
 *     实时同步版不在本项做。
 *   - 无服务端存储：核对过，没有可复用的服务端收藏分享表——
 *     服务端精选专题接口是站方精选（admin 写权限，面向所有访客），
 *     收藏云端同步是 per-user 同步不是分享；链接包因此是纯客户端的
 *     hash 链接，不登录、不花钱、不写库。
 *   - 导入复用 `useFavorites.importJson`（指纹去重 SSOT）：本模块只
 *     提供「包条目 → importJson 输入」的纯转换与逐条去重预览。
 *
 * 本模块是纯函数（无 window/document 依赖），行为全部可测。
 */

import { deepStripDangerousKeys } from '@/lib/modular/diy-layout-schema'
import { sanitizeBookmarkUrl, generateBookmarkId } from '@/lib/favorites-export-import'
import { fingerprintUrl } from '@/lib/import-workbench'

/** 链接包信封版本：`{ pack: 1, ... }`；未知版本整包拒收（见 parseLinkPack） */
export const LINK_PACK_VERSION = 1

/** hash 前缀：接收页 `/pack` 只认这个前缀，不认 `#diy=` */
export const LINK_PACK_HASH_PREFIX = '#pack='

/** 条数上限：20 条。单条中文标题+用途约 120–180 UTF-8 字节，20 条
 *  JSON 约 2.4–3.6KB → base64url 约 3.2–4.8KB，字节闸是硬闸，条数闸
 *  是给人看的、好理解的闸；两道闸都拦，超限提示分包。 */
export const LINK_PACK_MAX_ITEMS = 20

/** 编码后长度上限（字符数）：与 DIY 分享链接的 4KB 同口径 */
export const LINK_PACK_MAX_ENCODED_CHARS = 4096

/** 字段上限（字符数）：标题/备注/用途都按「一句话」收敛，超长截断并记进 notes */
export const LINK_PACK_TITLE_MAX = 40
export const LINK_PACK_NOTE_MAX = 200
export const LINK_PACK_ITEM_TITLE_MAX = 60
export const LINK_PACK_ITEM_PURPOSE_MAX = 40

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 打包输入：一条收藏（调用方从 LocalFavorite 映射过来） */
export interface LinkPackItemInput {
  /** 站点 id（有则带上，供接收页核对「站点已删」与导入时保 identity） */
  siteId?: string
  title: string
  href: string
  /** 一句话用途；空时取收藏简介/备注，仍空则不填 */
  purpose?: string
}

/** 信封里的单条（短键省字节） */
export interface LinkPackItem {
  /** 站点 id（可选） */
  id?: string
  /** 标题 */
  t: string
  /** 链接 */
  u: string
  /** 一句话用途（可选） */
  p?: string
}

/** 链接包信封（快照：生成时刻的拷贝，之后原收藏怎么变都不影响它） */
export interface LinkPackEnvelope {
  pack: typeof LINK_PACK_VERSION
  title: string
  note?: string
  /** 发布时刻（毫秒时间戳）；接收页据此显示「发布于某日」 */
  publishedAt: number
  items: LinkPackItem[]
}

export interface LinkPackBuildInput {
  title: string
  note?: string
  items: LinkPackItemInput[]
  /** 测试/调用方指定发布时间；默认 Date.now() */
  publishedAt?: number
}

export type LinkPackBuildOutcome =
  | { ok: true; pack: LinkPackEnvelope; url: string; encodedLength: number; notes: string[] }
  | { ok: false; reason: string }

/* ------------------------------------------------------------------ *
 * base64url（UTF-8 字节 ↔ base64url 字符串），浏览器与 Node 通用
 * ------------------------------------------------------------------ */

const B64URL_RE = /^[A-Za-z0-9_-]*={0,2}$/

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(text: string): Uint8Array | null {
  if (!B64URL_RE.test(text) || text.length % 4 === 1) return null
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function encodeLinkPackJson(json: string): string {
  return bytesToBase64Url(new TextEncoder().encode(json))
}

export function decodeLinkPackJson(encoded: string): string | null {
  const bytes = base64UrlToBytes(encoded)
  if (!bytes) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * 生成：输入 → 信封 → `#pack=` 链接
 * ------------------------------------------------------------------ */

function truncateWithNote(value: string, max: number, label: string, notes: string[]): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  notes.push(`${label}超过 ${max} 字，已截断`)
  return trimmed.slice(0, max)
}

/**
 * 生成链接包（快照）：输入被深拷贝进信封，调用方事后改原收藏不影响包。
 *
 * 拒绝只发生在生成侧（空选、超 20 条、某条无有效链接、编码超 4KB），
 * 原因直接给用户看；接收侧不再对「生成时就能拦住」的问题二次报错。
 */
export function buildLinkPack(input: LinkPackBuildInput, base: { origin: string; pathname: string }): LinkPackBuildOutcome {
  if (!base || typeof base.origin !== 'string' || typeof base.pathname !== 'string') {
    return { ok: false, reason: '当前页面地址不完整，没法生成链接包' }
  }
  const items = Array.isArray(input?.items) ? input.items : []
  if (items.length === 0) {
    return { ok: false, reason: '请先选中至少 1 个收藏，再打包成链接包' }
  }
  if (items.length > LINK_PACK_MAX_ITEMS) {
    return {
      ok: false,
      reason: `链接包一次最多打包 ${LINK_PACK_MAX_ITEMS} 个站点，你选了 ${items.length} 个，请分两次打包（比如先打包前 ${LINK_PACK_MAX_ITEMS} 个）`,
    }
  }
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) {
    return { ok: false, reason: '请给链接包起个标题，对方打开时先看到它' }
  }
  const notes: string[] = []
  const packTitle = truncateWithNote(title, LINK_PACK_TITLE_MAX, '链接包标题', notes)
  const packNote =
    typeof input.note === 'string' && input.note.trim()
      ? truncateWithNote(input.note, LINK_PACK_NOTE_MAX, '链接包备注', notes)
      : undefined
  const publishedAt =
    typeof input.publishedAt === 'number' && Number.isFinite(input.publishedAt) && input.publishedAt > 0
      ? input.publishedAt
      : Date.now()

  const packItems: LinkPackItem[] = []
  for (let i = 0; i < items.length; i++) {
    const raw = items[i]
    const href = sanitizeBookmarkUrl(typeof raw?.href === 'string' ? raw.href : '')
    if (!href) {
      return { ok: false, reason: `第 ${i + 1} 个站点链接无效（不是 http/https 地址），没法打包` }
    }
    const itemTitle =
      typeof raw?.title === 'string' && raw.title.trim()
        ? truncateWithNote(raw.title, LINK_PACK_ITEM_TITLE_MAX, `第 ${i + 1} 个站点标题`, notes)
        : href
    const item: LinkPackItem = { t: itemTitle, u: href }
    if (typeof raw?.siteId === 'string' && raw.siteId.trim()) item.id = raw.siteId.trim()
    if (typeof raw?.purpose === 'string' && raw.purpose.trim()) {
      item.p = truncateWithNote(raw.purpose, LINK_PACK_ITEM_PURPOSE_MAX, `第 ${i + 1} 个站点用途`, notes)
    }
    packItems.push(item)
  }

  const pack: LinkPackEnvelope = {
    pack: LINK_PACK_VERSION,
    title: packTitle,
    ...(packNote ? { note: packNote } : {}),
    publishedAt,
    items: packItems,
  }
  const encoded = encodeLinkPackJson(JSON.stringify(pack))
  if (encoded.length > LINK_PACK_MAX_ENCODED_CHARS) {
    return {
      ok: false,
      reason: `链接包内容太长（超过 4KB 上限），请减少站点数量或缩短标题/用途后重试，也可以分成两个包`,
    }
  }
  return { ok: true, pack, url: `${base.origin}${base.pathname}${LINK_PACK_HASH_PREFIX}${encoded}`, encodedLength: encoded.length, notes }
}

/* ------------------------------------------------------------------ *
 * 解码：`#pack=` hash → 原始 JSON（信封级损坏在这里拦，整包拒收）
 * ------------------------------------------------------------------ */

export type DecodedLinkPack = { ok: true; raw: unknown } | { ok: false; reason: string }

export function decodeLinkPackPayload(hash: string): DecodedLinkPack {
  const encoded =
    typeof hash === 'string' && hash.startsWith(LINK_PACK_HASH_PREFIX)
      ? hash.slice(LINK_PACK_HASH_PREFIX.length)
      : hash
  if (!encoded) return { ok: false, reason: '链接里没有链接包内容' }
  if (encoded.length > LINK_PACK_MAX_ENCODED_CHARS) {
    return { ok: false, reason: '链接包超过 4KB 上限，已整条忽略' }
  }
  const json = decodeLinkPackJson(encoded)
  if (json === null) {
    return { ok: false, reason: '链接包解析失败：内容已损坏，请让对方重新发一条' }
  }
  if (json.length > LINK_PACK_MAX_ENCODED_CHARS * 2) {
    return { ok: false, reason: '链接包超过 4KB 上限，已整条忽略' }
  }
  try {
    return { ok: true, raw: JSON.parse(json) }
  } catch {
    return { ok: false, reason: '链接包解析失败：内容已损坏，请让对方重新发一条' }
  }
}

/* ------------------------------------------------------------------ *
 * 解析：原始 JSON → 可渲染的包（条目级损坏逐条标注，不整页挂）
 * ------------------------------------------------------------------ */

export type PackItemStatus = 'ok' | 'invalid' | 'deleted'

export interface ParsedLinkPackItem {
  index: number
  siteId?: string
  title: string
  href: string
  purpose?: string
  status: PackItemStatus
  /** 逐条问题（只在 status !== 'ok' 时有）：给接收页逐条标注用 */
  problem?: string
}

export interface ParsedLinkPack {
  ok: boolean
  /** 标题/备注/发布时间（ok 时一定有） */
  title?: string
  note?: string
  /** 发布时间戳；缺失/非法时为 null，接收页显示「发布日期未知」 */
  publishedAt: number | null
  items: ParsedLinkPackItem[]
  validCount: number
  invalidCount: number
  dropped: number
  notes: string[]
  error?: string
}

/**
 * 解析链接包。
 *
 * 整包拒收（ok:false）只发生在「没有可逐条恢复的内容」时：不是对象、
 * 版本未知、items 不是数组/为空。其它问题一律逐条处理：坏链接的条目标
 * 记 `invalid`，其余照常渲染、照常打开、照常导入——一条坏链接不该
 * 让整包作废。
 */
export function parseLinkPack(raw: unknown): ParsedLinkPack {
  const fail = (error: string): ParsedLinkPack => ({
    ok: false,
    publishedAt: null,
    items: [],
    validCount: 0,
    invalidCount: 0,
    dropped: 0,
    notes: [],
    error,
  })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('链接包内容不是有效的清单，请让对方重新发一条')
  }
  // 危险键深剥（与 DIY 分享同口径）：__proto__/constructor/prototype
  // 整棵树剔除，剥掉的记进 dropped；循环引用直接整包拒收。
  const stripped = deepStripDangerousKeys(raw)
  if (stripped.cyclic.length > 0) {
    return fail('链接包内容无法解析（结构异常），请让对方重新发一条')
  }
  const obj = stripped.value as Record<string, unknown>
  const dropped = stripped.stripped.length
  const notes: string[] = []
  if (dropped > 0) notes.push(`已去掉 ${dropped} 个不安全字段`)
  if (obj.pack !== LINK_PACK_VERSION) {
    return fail('链接包版本不受支持（可能是新版生成的包），请更新后再打开，或让对方重新发一条')
  }
  const unknownTop = Object.keys(obj).filter((k) => !['pack', 'title', 'note', 'publishedAt', 'items'].includes(k))
  if (unknownTop.length > 0) notes.push(`忽略了 ${unknownTop.length} 个未知字段：${unknownTop.slice(0, 3).join('、')}`)
  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, LINK_PACK_TITLE_MAX) : '未命名链接包'
  if (typeof obj.title !== 'string' || !obj.title.trim()) notes.push('链接包没有标题，已显示为「未命名链接包」')
  const note =
    typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim().slice(0, LINK_PACK_NOTE_MAX) : undefined
  const publishedAt =
    typeof obj.publishedAt === 'number' && Number.isFinite(obj.publishedAt) && obj.publishedAt > 0
      ? obj.publishedAt
      : null
  if (publishedAt === null) notes.push('链接包缺少发布时间，无法确认快照日期')
  if (!Array.isArray(obj.items) || obj.items.length === 0) {
    return fail('链接包里没有任何站点，请让对方重新发一条')
  }

  const items: ParsedLinkPackItem[] = []
  let invalidCount = 0
  obj.items.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      invalidCount++
      items.push({ index, title: '无法识别的条目', href: '', status: 'invalid', problem: '这条内容已损坏' })
      return
    }
    const e = entry as Record<string, unknown>
    const href = typeof e.u === 'string' ? sanitizeBookmarkUrl(e.u) : ''
    const rawTitle = typeof e.t === 'string' ? e.t.trim() : ''
    if (!href) {
      invalidCount++
      items.push({
        index,
        siteId: typeof e.id === 'string' ? e.id : undefined,
        title: rawTitle || '链接无效的条目',
        href: '',
        status: 'invalid',
        problem: '链接无效（不是 http/https 地址），打不开',
      })
      return
    }
    items.push({
      index,
      siteId: typeof e.id === 'string' && e.id.trim() ? e.id.trim() : undefined,
      title: rawTitle ? rawTitle.slice(0, LINK_PACK_ITEM_TITLE_MAX) : href,
      href,
      purpose:
        typeof e.p === 'string' && e.p.trim() ? e.p.trim().slice(0, LINK_PACK_ITEM_PURPOSE_MAX) : undefined,
      status: 'ok',
    })
  })
  return {
    ok: true,
    title,
    note,
    publishedAt,
    items,
    validCount: items.length - invalidCount,
    invalidCount,
    dropped,
    notes,
  }
}

/* ------------------------------------------------------------------ *
 * 展示文案（纯函数，供接收页与对话框共用）
 * ------------------------------------------------------------------ */

/** 快照标注：`快照版 · 发布于 2026-11-13 · 内容不再更新` */
export function describeLinkPackSnapshot(publishedAt: number | null): string {
  if (publishedAt === null) return '快照版 · 发布日期未知 · 内容不再更新'
  return `快照版 · 发布于 ${formatPackDate(publishedAt)} · 内容不再更新`
}

export function formatPackDate(publishedAt: number): string {
  // 按用户本地日期显示：toISOString 是 UTC，北京时间凌晨 0–8 点发布的包
  // 会被算成前一天（例如 11 月 13 日 01:00 CST → UTC 11 月 12 日）。
  const d = new Date(publishedAt)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/* ------------------------------------------------------------------ *
 * 导入：包条目 → importJson 输入 + 逐条去重预览
 * ------------------------------------------------------------------ */

export type ImportPlanStatus = 'new' | 'already-saved' | 'invalid'

export interface LinkPackImportPlanItem {
  index: number
  title: string
  href: string
  status: ImportPlanStatus
}

/**
 * 导入预览：逐条判定「新增 / 已收藏 / 无效」，与 importJson 的去重键
 * 同为 fingerprintUrl（SSOT）——预览说的「已收藏」与实际导入跳过的
 * 一定是同一批，不会预览一套、导入另一套。
 */
export function planLinkPackImport(
  items: ParsedLinkPackItem[],
  existingHrefs: string[],
): LinkPackImportPlanItem[] {
  const existing = new Set(existingHrefs.map((h) => fingerprintUrl(h)).filter(Boolean))
  return items.map((item) => {
    if (item.status !== 'ok' || !item.href) return { index: item.index, title: item.title, href: item.href, status: 'invalid' as const }
    const fp = fingerprintUrl(item.href)
    return {
      index: item.index,
      title: item.title,
      href: item.href,
      status: fp && existing.has(fp) ? ('already-saved' as const) : ('new' as const),
    }
  })
}

/**
 * 包条目 → `favorites.importJson` 的输入 JSON。
 * 用途写进 description（接收方在收藏里一眼看到这条是干嘛的）；
 * siteId 沿用包里的（同一 href 的 siteId 是确定的 djb2，不会撞出
 * 第二个身份），没有则按 href 生成；无效条目不进输入。
 */
export function linkPackItemsToImportJson(items: ParsedLinkPackItem[]): string {
  const incoming = items
    .filter((item) => item.status === 'ok' && item.href)
    .map((item) => ({
      siteId: item.siteId ?? generateBookmarkId(item.href),
      title: item.title,
      href: item.href,
      description: item.purpose,
      createdAt: Date.now(),
    }))
  return JSON.stringify({ version: 1, items: incoming })
}

/* ------------------------------------------------------------------ *
 * 一键全部打开（纯核：opener 由调用方注入 window.open）
 * ------------------------------------------------------------------ */

export interface OpenAllResult {
  attempted: number
  opened: number
  /** opener 返回 null/undefined = 被浏览器拦截 */
  blocked: number
}

/**
 * 逐条打开：浏览器经常只放行第一个弹出窗口、拦截其余——拦截数必须
 * 如实报给用户（「请允许本站弹出窗口后重试」），不能报「已全部打开」。
 */
export function openAllPackItems(
  items: ParsedLinkPackItem[],
  opener: (href: string) => unknown,
): OpenAllResult {
  const valid = items.filter((item) => item.status === 'ok' && item.href)
  let opened = 0
  let blocked = 0
  for (const item of valid) {
    let out: unknown
    try {
      out = opener(item.href)
    } catch {
      blocked++
      continue
    }
    if (out === null || out === undefined) blocked++
    else opened++
  }
  return { attempted: valid.length, opened, blocked }
}
