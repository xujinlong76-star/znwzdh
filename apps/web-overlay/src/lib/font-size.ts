/**
 * 全站字号档位（年长 / 视力弱用户的「大字模式」）。
 *
 * 现状缺口（2026-11-10 审计）：站内有主题（明暗）与内容密度（紧凑/舒适/
 * 宽松）两套可切换项，唯独没有字号缩放——密度改的是间距不是字号。
 * 本模块补这一档：三档（标准 16 / 大字 18 / 特大 20）通过设置 <html>
 * 的 font-size 生效，全站用 rem 的排版等比放大；选择只存本机
 * localStorage（与成长档案同一纪律），水合前由内联脚本先落值防闪烁
 *（与 density-bootstrap 同款做法）。纯模块：不 import React，
 * 可被 layout（服务端）安全引用拼脚本。
 */

export const FONT_SIZE_STORAGE_KEY = 'navhub.fontSize.v1'

export type FontSizeLevel = 'standard' | 'large' | 'xlarge'

export const FONT_SIZE_PX: Record<FontSizeLevel, number> = {
  standard: 16,
  large: 18,
  xlarge: 20,
}

export const FONT_SIZE_LABEL: Record<FontSizeLevel, string> = {
  standard: '标准字号',
  large: '大字',
  xlarge: '特大字',
}

export function parseFontSizeLevel(raw: string | null): FontSizeLevel {
  return raw === 'large' || raw === 'xlarge' ? raw : 'standard'
}

export function loadFontSizeLevel(storage: Storage | null): FontSizeLevel {
  if (!storage) return 'standard'
  try {
    return parseFontSizeLevel(storage.getItem(FONT_SIZE_STORAGE_KEY))
  } catch {
    return 'standard'
  }
}

export function applyFontSizeLevel(level: FontSizeLevel, root: HTMLElement | null): void {
  if (!root) return
  root.style.fontSize = `${FONT_SIZE_PX[level]}px`
  root.dataset.fontSize = level
}

/** 水合前内联脚本：只含编译期常量（存储键 + 档位表），无外部输入 */
export const FONT_SIZE_PREPAINT_SCRIPT = [
  '(function(){',
  'try{',
  `var px=${JSON.stringify(FONT_SIZE_PX)};`,
  `var level=localStorage.getItem(${JSON.stringify(FONT_SIZE_STORAGE_KEY)})||'standard';`,
  'if(!px[level])level=\'standard\';',
  'document.documentElement.style.fontSize=px[level]+"px";',
  'document.documentElement.dataset.fontSize=level;',
  '}catch(e){}',
  '})();',
].join('')
