/**
 * 首屏数字直达：纯函数（可单测，不 import React）。
 *
 * 映射的唯一口径：速览坞 Top 9（见 lib/speed-dial-order.ts 的
 * computeSpeedDialSites）。数字键 1~9 打开坞里对应位置的站点；
 * Ctrl+Shift+1~0 打开用户自定义快拨位（存在 DIY 配置 quickDialSlots 里）。
 *
 * 按键解析一律用 e.code，不用 e.key：Shift+1 的 e.key 是 '!'，
 * Alt+1 在 macOS 上是 '¡'，只有 e.code 稳定地说是 Digit1。
 */
import { safeHref, safeWindowOpen } from '@/lib/safe-url'
import { recordOfflineVisit } from '@/lib/offline-recent'
import { getIdentity } from '@/lib/identity'
import { reportClick } from '@/lib/navhub-api'

/** 自定义快拨位：Ctrl+Shift+数字，十个位（0 排最后） */
export type QuickDialDigit = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0'

export const QUICK_DIAL_DIGITS: readonly QuickDialDigit[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

export type QuickDialSlots = Partial<Record<QuickDialDigit, string>>

const QUICK_DIAL_DIGIT_SET: ReadonlySet<string> = new Set(QUICK_DIAL_DIGITS)

export function isQuickDialDigit(value: unknown): value is QuickDialDigit {
  return typeof value === 'string' && QUICK_DIAL_DIGIT_SET.has(value)
}

/** 数字直达能打开的最小站点形状：坞列表项 / 分类卡片都满足它 */
export interface DialSite {
  id: string
  title: string
  href: string
  icon?: string | null
  useDefaultIcon?: boolean
}

const DIGIT_CODE_MAP: Readonly<Record<string, QuickDialDigit>> = {
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  Digit0: '0',
  Numpad1: '1',
  Numpad2: '2',
  Numpad3: '3',
  Numpad4: '4',
  Numpad5: '5',
  Numpad6: '6',
  Numpad7: '7',
  Numpad8: '8',
  Numpad9: '9',
  Numpad0: '0',
}

/**
 * 只看 e.code 解析数字键：Digit1~Digit0 与 Numpad1~Numpad0 都命中；
 * 字母键 / F 键 / 其它返回 null。修饰键不在这里判定，由调用方分流。
 */
export function parseDigitCode(e: { code?: string }): QuickDialDigit | null {
  if (!e || typeof e.code !== 'string') return null
  return DIGIT_CODE_MAP[e.code] ?? null
}

/**
 * 坞前 9 → 数字映射。byDigit[i] 是数字 i+1 的站点（i = 0..8），
 * 不足 9 位补 null；digitById 是反查（站点 id → 数字 1..9），
 * 卡片角标与 aria-keyshortcuts 都读它。禁止任何一方自己重算顺序。
 */
export function buildDialMap(dialSites: DialSite[]): {
  byDigit: (DialSite | null)[]
  digitById: Map<string, number>
} {
  const byDigit: (DialSite | null)[] = Array.from({ length: 9 }, (_, i) => dialSites[i] ?? null)
  const digitById = new Map<string, number>()
  byDigit.forEach((site, i) => {
    if (site && !digitById.has(site.id)) digitById.set(site.id, i + 1)
  })
  return { byDigit, digitById }
}

/**
 * 自定义快拨位解析（纯函数）：命中返回站点；空位 / 失效 id（站点已删，
 * siteIndex 里查不到）返回 null。失效绑定保留原值不删，由设置 UI 提示用户改绑。
 */
export function resolveQuickDialSlot(
  slots: QuickDialSlots | null | undefined,
  digit: QuickDialDigit,
  siteIndex: ReadonlyMap<string, DialSite>,
): DialSite | null {
  const siteId = slots?.[digit]
  if (typeof siteId !== 'string' || !siteId) return null
  return siteIndex.get(siteId) ?? null
}

/* ------------------------------------------------------------------ *
 * 打开目标：与 navigation-card handleLinkClick / search-palette openSite
 * 同款副作用 + 安全闸，同步调用（必须在 keydown 处理函数内同步执行，
 * 用户激活态下弹窗拦截器才放行；一旦 await 再开会被拦截）。
 * ------------------------------------------------------------------ */

export interface OpenDialTargetOptions {
  /** Shift+数字：强制新标签页（前台与否浏览器定，不叫「后台打开」） */
  forceNewTab: boolean
  /** 用户偏好：openLinksInNewTab 决定 _blank/_self（未保存过偏好时跟随后台配置） */
  linkTarget: '_blank' | '_self'
}

/**
 * 打开一个数字直达目标。返回 false = href 不安全 / 打不开（调用方 toast，
 * 但数字键的空位/失效位按静默处理，不 toast）；成功返回 true。
 *
 * 顺序有讲究：安全闸先行——javascript: 之类的脏 href 被拦住时，
 * reportClick 与 recordOfflineVisit 一律不调（脏点击不该进统计与学习）。
 */
export function openDialTarget(site: DialSite, options: OpenDialTargetOptions): boolean {
  if (typeof window === 'undefined') return false
  const url = safeHref(site.href, '')
  if (!url) return false
  reportClick(site.id, getIdentity())
  recordOfflineVisit({
    id: site.id,
    title: site.title,
    href: url,
    icon: site.icon ?? null,
  })
  if (options.forceNewTab || options.linkTarget === '_blank') {
    // 新窗口分支走公共安全闸 safeWindowOpen（内含 safeHref + noopener）；
    // _self 分支见下：同页跳转没有「新窗口闸」可用，url 本身已在函数顶部
    // 过 safeHref，且在 url-hygiene 例外清单里登记并附证据（与 spotlight-modal
    // / search-palette 的 openSite 同款）。
    return safeWindowOpen(url) !== null
  }
  window.location.href = url
  return true
}

/* ------------------------------------------------------------------ *
 * 按键判定（纯函数）：useNumberDial 的 hook 只负责从 DOM 收集守卫快照，
 * 判定本身全在这里，单测直接喂事件替身与快照即可。
 * ------------------------------------------------------------------ */

export interface NumberDialGuardState {
  /** 数字直达总开关（用户设置 numberDialEnabled，默认开） */
  enabled: boolean
  /** 中文输入法组字中 */
  composing: boolean
  /** 焦点/目标在输入态（INPUT/TEXTAREA/SELECT/contentEditable/role 输入框） */
  typing: boolean
  /** 任意 role=dialog/alertdialog（非 aria-hidden）正打开 */
  dialogOpen: boolean
  /** 焦点在 dnd-kit 拖拽手柄上（键盘拖拽进行中时焦点一定在这里） */
  dragHandleFocused: boolean
  /** 多选模式：此时点卡是选中不是打开 */
  selectionMode: boolean
  /** DIY 编辑态 */
  editingLayout: boolean
}

export type NumberDialAction =
  | { kind: 'dock'; digit: number; site: DialSite; forceNewTab: boolean }
  | { kind: 'quick'; digit: QuickDialDigit; site: DialSite; forceNewTab: boolean }

export interface NumberDialDecisionInput {
  guards: NumberDialGuardState
  /** buildDialMap 的产物：坞前 9 的数字映射 */
  dialMap: { byDigit: (DialSite | null)[]; digitById: Map<string, number> }
  quickDialSlots: QuickDialSlots | null | undefined
  siteIndex: ReadonlyMap<string, DialSite>
}

/**
 * 按序短路判定一次数字按键：
 *   1. 总开关 / 组字中 / 输入态 / 弹窗打开 / 拖拽手柄聚焦 / 多选态 / 编辑态 → 放行；
 *   2. 不是数字键 → 放行；
 *   3. Ctrl+Shift+数字（无 Alt/Meta）→ 自定义快拨位，空位/失效 id 静默放行；
 *   4. 带 Alt/Ctrl/Meta 的其它组合 → 放行（Alt+1~3 是视图切换，Ctrl/Meta+数字浏览器保留）；
 *   5. Shift+数字 1~9 → 坞映射位，强制新标签页；
 *   6. 裸数字 1~9 → 坞映射位，按用户偏好打开；数字 0 没有坞映射位 → 放行。
 */
export function resolveNumberDialAction(
  e: {
    code?: string
    ctrlKey?: boolean
    metaKey?: boolean
    shiftKey?: boolean
    altKey?: boolean
  },
  input: NumberDialDecisionInput,
): NumberDialAction | null {
  const { guards, dialMap, quickDialSlots, siteIndex } = input
  if (
    !guards.enabled ||
    guards.composing ||
    guards.typing ||
    guards.dialogOpen ||
    guards.dragHandleFocused ||
    guards.selectionMode ||
    guards.editingLayout
  ) {
    return null
  }
  const digit = parseDigitCode(e)
  if (!digit) return null
  const ctrl = Boolean(e.ctrlKey)
  const meta = Boolean(e.metaKey)
  const shift = Boolean(e.shiftKey)
  const alt = Boolean(e.altKey)
  // Ctrl+Shift+数字 → 自定义快拨位（Ctrl+数字浏览器保留收不到，
  // Alt+数字已被视图切换占用，所以自定义位用 Ctrl+Shift）。
  if (ctrl && shift && !meta && !alt) {
    const site = resolveQuickDialSlot(quickDialSlots, digit, siteIndex)
    if (!site) return null
    return { kind: 'quick', digit, site, forceNewTab: false }
  }
  if (alt || ctrl || meta) return null
  // 坞映射只有 1~9 九个位：0 没有对应位。
  if (digit === '0') return null
  const site = dialMap.byDigit[Number(digit) - 1] ?? null
  if (!site) return null
  return { kind: 'dock', digit: Number(digit), site, forceNewTab: shift }
}
