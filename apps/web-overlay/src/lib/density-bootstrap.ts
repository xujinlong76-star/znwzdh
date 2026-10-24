/**
 * 首屏密度引导（水合前把 `[data-density]` 写进 `<html>`）。
 *
 * 真实缺陷：卡片密度驱动着 `styles/globals.css` 里的 `--density-*` 变量，而
 * `DensityProvider` 只在 **useEffect** 里落属性。服务端 HTML 永远没有
 * `data-density`，浏览器先按默认档画一整屏，水合完成后才切到用户存的档位 ——
 * 首页上千张卡片的间距同时变化，这是本站最大的一块 CLS（实测把整片网格推走），
 * 而且只在「设置过极客密排/画廊沉浸」的老用户身上出现，越常用越明显。
 *
 * 判据必须与 `lib/user-preferences.ts` 完全一致，否则脚本写完 React 又改一遍，
 * 等于把抖动搬个时间：
 *   1. 档位只认偏好里的 `cardDensity`（comfortable/compact/minimal）；
 *   2. 这台设备从未保存过偏好（`updatedAt` 为假）时，才回退读旧独立键
 *      `navhub_content_density`（老版 DensityToggle 写的三档名）。
 * 映射表从这里导入同一份常量，脚本串由 `JSON.stringify` 拼装 —— 不存在第二份真相。
 *
 * 依赖边界（踩过坑）：本文件由 `app/layout.tsx`（服务端组件）使用，
 * 所以只能 import 纯模块。曾经它 import 的是 `user-preferences`，而那个模块顶部
 * `import { useSyncExternalStore } from 'react'` —— Next 判定「把依赖 React hook 的模块
 * 导进了 RSC」，直接把全站路由（含 /api/*）打成 500。映射表现在住 content-density.ts。
 */

import { CARD_DENSITY_TO_CONTENT } from './content-density'
import { USER_SETTINGS_STORAGE_KEY } from './user-settings'

/** 老版 DensityToggle 的独立键（仅作为「从未保存过偏好」时的回退初值） */
export const LEGACY_DENSITY_STORAGE_KEY = 'navhub_content_density'

/** 与 `isContentDensity()` 同集合：CSS 只认这三档，写别的会落回默认变量 */
export const CONTENT_DENSITY_VALUES = ['dense', 'comfortable', 'spacious'] as const

/**
 * 内联脚本正文。刻意不含任何外部输入（无用户数据、无环境变量插值），
 * 拼进去的只有两个编译期常量：存储键名与映射表。
 */
export const DENSITY_PREPAINT_SCRIPT = [
  '(function(){',
  'try{',
  // 默认档与 CSS 无属性时的取值一致，未登录/未设置过的访客不会看到任何变化
  "var density='comfortable';",
  'var cardMap=' + JSON.stringify(CARD_DENSITY_TO_CONTENT) + ';',
  'var valid=' + JSON.stringify(Object.fromEntries(CONTENT_DENSITY_VALUES.map((v) => [v, 1]))) + ';',
  'var raw=window.localStorage.getItem(' + JSON.stringify(USER_SETTINGS_STORAGE_KEY) + ');',
  'var saved=false;',
  'if(raw){',
  'var s={};try{s=JSON.parse(raw)||{}}catch(e){s={}}',
  'if(s.cardDensity&&cardMap[s.cardDensity]){density=cardMap[s.cardDensity]}',
  'saved=!!s.updatedAt;',
  '}',
  'if(!saved){',
  'var legacy=window.localStorage.getItem(' + JSON.stringify(LEGACY_DENSITY_STORAGE_KEY) + ');',
  'if(legacy&&valid[legacy]){density=legacy}',
  '}',
  "document.documentElement.setAttribute('data-density',density);",
  '}catch(e){}',
  '})();',
].join('')
