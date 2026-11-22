/**
 * 高对比度：加深文字与边框，弱光下也看得清。
 *
 * 结构 1:1 对标 lib/elder-mode.ts（load / set / apply 三函数 + 事件 +
 * LABEL 唯一出处 + 水合前内联脚本），与长辈模式独立、可同时开启：
 * 只在 <html> 上挂 data-high-contrast="on" 供 CSS 挂钩，不改字号、
 * 密度偏好，不碰长辈模式与主题属性；状态只存本机 localStorage
 * （与长辈模式同一纪律，不进账号同步）。视觉规则（[data-high-contrast]
 * 下的文字/边框加深）由全局样式层挂接，本模块只负责状态、落值与事件。
 *
 * 存储格式演进（都认，不丢旧值）：
 *   - 旧版只存裸布尔 JSON（"true" / "false"），parseRecord 与水合前
 *     脚本都保留了这支兼容分支；
 *   - 新版存 { on: boolean } 记录，与 elder-mode 的记录形态一致。
 *
 * 系统偏好跟随：
 *   - 首次访问且无已存偏好时，跟随系统“提高对比度”偏好：
 *     loadHighContrast 的第二个参数显式传入时以它为准；省略时
 *     （如外观弹窗只传 storage 的调用）自动读
 *     window.matchMedia('(prefers-contrast: more)')，命中则自动开启。
 *   - 一旦用户手动切换过（setHighContrast），另写「已手动」标记键
 *    （navhub.highContrast.manual.v1），此后 load 不再跟随系统偏好
 *     变化，只认手动值。
 * 水合前由内联脚本先落值防闪烁（与 elder-mode / font-size 同款做法）：
 * 回放已存值；无已存值且无手动标记时跟随系统 prefers-contrast: more
 * （否则首访系统偏好用户会看到开关显示“开”而页面没变高对比——
 * 开关组件只读 load 的返回值进 React state，不落 <html> 属性）。
 */

export const HIGH_CONTRAST_STORAGE_KEY = 'navhub.highContrast.v1'

/** 用户手动切换过的标记：有它在，load 就不再跟随系统偏好变化 */
export const HIGH_CONTRAST_MANUAL_STORAGE_KEY = 'navhub.highContrast.manual.v1'

export const HIGH_CONTRAST_CHANGED_EVENT = 'navhub:high-contrast-changed'

interface HighContrastRecord {
  on: boolean
}

function parseRecord(raw: string | null): HighContrastRecord {
  if (!raw) return { on: false }
  try {
    const parsed = JSON.parse(raw) as Partial<HighContrastRecord> | boolean
    // 旧版只存过布尔字符串：JSON.parse('true') 成功但 parsed 是布尔值不是
    // 对象，不加这支判断会走到 parsed.on === undefined → 误判为关闭。
    if (typeof parsed === 'boolean') return { on: parsed }
    return { on: parsed.on === true }
  } catch {
    // 旧版只存过布尔字符串时也认
    return { on: raw === 'true' }
  }
}

function hasStoredPreference(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(HIGH_CONTRAST_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

function hasManualFlag(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(HIGH_CONTRAST_MANUAL_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/** 调用方未显式传系统偏好时，自己读 matchMedia；读不到（node/无窗口）按 false 计 */
function readSystemPreference(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-contrast: more)').matches === true
  } catch {
    return false
  }
}

/**
 * 读当前有效值。已存偏好（手动值）在先；手动标记在、无记录时按关计
 * （防御分支：正常流程 set 一定同时写记录与标记）；两者皆无时跟随
 * 系统偏好（显式传入的 systemPrefersMoreContrast 优先，省略则自读
 * matchMedia）。storage 为 null 时只返回系统偏好，不抛错。
 */
export function loadHighContrast(
  storage: Storage | null,
  systemPrefersMoreContrast?: boolean,
): boolean {
  const systemPref = systemPrefersMoreContrast ?? readSystemPreference()
  if (!storage) return systemPref
  try {
    if (hasStoredPreference(storage)) {
      return parseRecord(storage.getItem(HIGH_CONTRAST_STORAGE_KEY)).on
    }
    if (hasManualFlag(storage)) return false
    return systemPref
  } catch {
    return false
  }
}

function writeRecord(storage: Storage | null, record: HighContrastRecord): void {
  if (!storage) return
  try {
    storage.setItem(HIGH_CONTRAST_STORAGE_KEY, JSON.stringify(record))
  } catch {
    /* 写不进本机存储时本次会话内仍生效 */
  }
}

function writeManualFlag(storage: Storage | null): void {
  if (!storage) return
  try {
    storage.setItem(HIGH_CONTRAST_MANUAL_STORAGE_KEY, 'true')
  } catch {
    /* 见 writeRecord */
  }
}

/** 把开关落到 <html>：属性供 CSS 挂钩；不碰长辈模式与主题属性 */
export function applyHighContrast(on: boolean, root: HTMLElement | null): void {
  if (!root) return
  if (on) {
    root.setAttribute('data-high-contrast', 'on')
  } else {
    root.removeAttribute('data-high-contrast')
  }
}

/**
 * 手动切换高对比度并持久化：写 {on} 记录 + 写「已手动」标记（此后
 * 不再跟随系统偏好），落属性，发事件（detail: { on }），返回开关值。
 * 存储不可用也不抛错。
 */
export function setHighContrast(on: boolean, storage: Storage | null = null): boolean {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
  writeRecord(store, { on })
  writeManualFlag(store)
  applyHighContrast(on, typeof document !== 'undefined' ? document.documentElement : null)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(HIGH_CONTRAST_CHANGED_EVENT, { detail: { on } }))
  }
  return on
}

/** 水合前内联脚本：只含编译期常量（存储键），无外部输入；旧版裸布尔与新版记录都认。
 * 无已存值且无手动标记时跟随系统 prefers-contrast: more（与 loadHighContrast 同口径，
 * 否则首访系统偏好用户的开关状态与页面实际会脱节）；已存值在先，手动标记在、无记录时按关计。 */
export const HIGH_CONTRAST_PREPAINT_SCRIPT = [
  '(function(){',
  'try{',
  `var raw=localStorage.getItem(${JSON.stringify(HIGH_CONTRAST_STORAGE_KEY)});`,
  'var on=false;',
  'try{var v=JSON.parse(raw);on=(typeof v==="boolean")?v:!!(v&&v.on);}catch(e){on=raw===\'true\';}',
  'var manual=false;',
  `try{manual=localStorage.getItem(${JSON.stringify(HIGH_CONTRAST_MANUAL_STORAGE_KEY)})==='true';}catch(e){}`,
  'if(raw===null&&!manual){',
  'try{if(typeof window!=="undefined"&&window.matchMedia){var m=window.matchMedia("(prefers-contrast: more)");if(m&&m.matches){on=true;}}}catch(e){}',
  '}',
  'if(on){',
  `document.documentElement.setAttribute("data-high-contrast","on");`,
  '}',
  '}catch(e){}',
  '})();',
].join('')

/** 开关文案的唯一出处：弹窗行副文案、按钮无障碍标签与播报共用 */
export const HIGH_CONTRAST_LABEL = {
  on: '高对比已开启',
  off: '高对比',
  hint: '加深文字与边框，弱光下也看得清；与长辈模式可同时开启；首次访问会跟随系统的“提高对比度”偏好，手动切换后以你的选择为准',
} as const
