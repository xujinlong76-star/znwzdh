/**
 * 长辈模式（完整版）：一键适老，不只是大字。
 *
 * 此前只有大字模式（三档字号 + 特大字档隐藏连胜条），没有独立的长辈模式
 * 入口与整套适老流程。本模块把散落的适老行为收成一个开关：
 *   1. 特大字（经 lib/font-size 置 20px，xlarge 档）；
 *   2. 宽松间距（<html data-elder-mode="on">，globals.css 按 spacious 同值
 *      覆盖密度变量，不碰用户存的密度偏好，关闭即还原）；
 *   3. 44px 最小触控目标（同上，CSS 限定主内容与导航内的控件）；
 *   4. 隐藏连胜条（StreakBar 本来就按 xlarge 档隐藏；本模块发事件让它在
 *      不刷新页面的情况下即时重判）。
 *
 * 只存本机 localStorage（与字号、密度同一纪律，不进账号同步）：
 * 开启时记住此前的字号档，关闭时还原——不开长辈模式的人不受任何影响。
 * 水合前由内联脚本先落值防闪烁（与 font-size / density 同款做法）。
 */

import {
  FONT_SIZE_LABEL,
  FONT_SIZE_PX,
  FONT_SIZE_STORAGE_KEY,
  applyFontSizeLevel,
  loadFontSizeLevel,
  parseFontSizeLevel,
  type FontSizeLevel,
} from './font-size'

export const ELDER_MODE_STORAGE_KEY = 'navhub.elderMode.v1'

export const ELDER_MODE_CHANGED_EVENT = 'navhub:elder-mode-changed'

interface ElderModeRecord {
  on: boolean
  /** 开启前用户的字号档，关闭时还原；缺失按 standard 计 */
  prevFontSize?: FontSizeLevel
}

function parseRecord(raw: string | null): ElderModeRecord {
  if (!raw) return { on: false }
  try {
    const parsed = JSON.parse(raw) as Partial<ElderModeRecord>
    return {
      on: parsed.on === true,
      prevFontSize:
        typeof parsed.prevFontSize === 'string'
          ? parseFontSizeLevel(parsed.prevFontSize)
          : undefined,
    }
  } catch {
    // 旧版只存过布尔字符串时也认
    return { on: raw === 'true' }
  }
}

export function loadElderMode(storage: Storage | null): boolean {
  if (!storage) return false
  try {
    return parseRecord(storage.getItem(ELDER_MODE_STORAGE_KEY)).on
  } catch {
    return false
  }
}

function readRecord(storage: Storage | null): ElderModeRecord {
  if (!storage) return { on: false }
  try {
    return parseRecord(storage.getItem(ELDER_MODE_STORAGE_KEY))
  } catch {
    return { on: false }
  }
}

function writeRecord(storage: Storage | null, record: ElderModeRecord): void {
  if (!storage) return
  try {
    storage.setItem(ELDER_MODE_STORAGE_KEY, JSON.stringify(record))
  } catch {
    /* 写不进本机存储时本次会话内仍生效 */
  }
}

/** 把开关落到 <html>：属性供 CSS 挂钩，字号走 font-size 的同一份档位表 */
export function applyElderMode(on: boolean, root: HTMLElement | null): void {
  if (!root) return
  if (on) {
    root.setAttribute('data-elder-mode', 'on')
    applyFontSizeLevel('xlarge', root)
  } else {
    root.removeAttribute('data-elder-mode')
  }
}

/**
 * 切换长辈模式并持久化。开启：记住当前字号、置特大字；关闭：还原记住的字号
 *（没记住过就回标准档）。调用后发事件，StreakBar 等监听者即时重判。
 */
export function setElderMode(on: boolean, storage: Storage | null = null): boolean {
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : null)
  const prev = readRecord(store)
  if (on) {
    const current = loadFontSizeLevel(store)
    writeRecord(store, { on: true, prevFontSize: current })
    try {
      store?.setItem(FONT_SIZE_STORAGE_KEY, 'xlarge')
    } catch {
      /* 见 writeRecord */
    }
    applyElderMode(true, typeof document !== 'undefined' ? document.documentElement : null)
  } else {
    const restore = prev.prevFontSize ?? 'standard'
    writeRecord(store, { on: false, prevFontSize: restore })
    try {
      store?.setItem(FONT_SIZE_STORAGE_KEY, restore)
    } catch {
      /* 见 writeRecord */
    }
    applyElderMode(false, typeof document !== 'undefined' ? document.documentElement : null)
    applyFontSizeLevel(restore, typeof document !== 'undefined' ? document.documentElement : null)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ELDER_MODE_CHANGED_EVENT, { detail: { on } }))
  }
  return on
}

/** 水合前内联脚本：只含编译期常量（存储键 + 特大字档 px），无外部输入 */
export const ELDER_MODE_PREPAINT_SCRIPT = [
  '(function(){',
  'try{',
  `var raw=localStorage.getItem(${JSON.stringify(ELDER_MODE_STORAGE_KEY)});`,
  'var on=false;',
  'try{on=!!(raw&&JSON.parse(raw).on);}catch(e){on=raw===\'true\';}',
  'if(on){',
  `document.documentElement.style.fontSize=${JSON.stringify(FONT_SIZE_PX.xlarge)}+"px";`,
  `document.documentElement.dataset.fontSize=${JSON.stringify('xlarge')};`,
  `document.documentElement.setAttribute("data-elder-mode","on");`,
  '}',
  '}catch(e){}',
  '})();',
].join('')

/** 开关文案的唯一出处：工具栏按钮与无障碍标签共用 */
export const ELDER_MODE_LABEL = {
  on: '长辈模式已开启',
  off: '长辈模式',
  hint: `一键适老：${FONT_SIZE_LABEL.xlarge}（20px）+ 宽松间距 + 44px 触控目标，关闭后字号还原`,
} as const
