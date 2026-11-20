/**
 * 04 命令面板 · 拼音前端匹配层（PoC，W5）。
 *
 * 原则（方案 §1.1，写死）：
 * - 只做前端匹配层，不动服务端：`/api/search` 薄代理不动，服务端 hits
 *   不重排、不重打分；拼音分只用于本地行（操作 / 工具 / 收藏 / 快捷链接）
 *   内部排序，不与服务端 RRF 分数比较。
 * - 只服务本地行：走 `matchSuggestionText` 的纯前端匹配层。
 * - 不接管 cmdk `filter`：`shouldFilter={false}` 现状不变。
 *
 * 加载（方案 §1.3，写死）：
 * - 禁止静态 import：本文件对 `pinyin-pro` 只有一处动态 `import()`；
 *   全仓 grep `from 'pinyin-pro'` / `require('pinyin-pro')` 必须零命中。
 * - 触发条件（见 `search-palette.tsx` 的 effect）：面板打开后，第一次出现
 *   拉丁字母查询且本地行目录非空时执行 `import('pinyin-pro')`。
 * - Promise 缓存复用；加载失败时把 promise 置回 null（下次可重试），
 *   失败期间拼音通道静默关闭、本地行回落到旧匹配，面板不报错。
 * - pre-fetch 先不开（等 W8 的 P-d 实测结论）。
 *
 * 参数（方案 §1.2，写死）：
 * - `toneType: 'none'` 是强制项：不带时 `额` 返回带调 `'é'`，查询 `e`
 *   永远对不上 `é`。
 * - 多音走 `type: 'all'` 的 `polyphonic[]`；`multiple: true` 只在单字时
 *   生效，多字词必须走 `type: 'all'`。
 * - 姓氏默认关闭（`曾` → `céng`）；站名含姓氏字时由 `PINYIN_FIXES` 修正，
 *   不全局开 `surname: 'head'`。
 * - `buildPinyinKeys` 返回的键统一小写：pinyin-pro 对拉丁原词保留大小写
 *  （如 `MOOC`），而 `matchPinyin` 对查询做 `toLowerCase()`；键不小写，
 *   拉丁站名就永远对不上小写查询。
 * - 已知局限（PoC 不修，另立任务）：`toneType: 'none'` 保留 `ü`
 *  （`旅行` → `lüxing`）；打 `lvxing` / `luxing` 对不上，只有首字母
 *   `lx` 与 `xiecheng` 能命中。
 *
 * 修正名单（方案 §1.5）：
 * - 离线核对（2026-11-20，脚本见 /tmp/w5-offline-pinyin.mjs，不入库）：
 *   navigation.json 全部 383 站标题 + 25 本地行标题逐字跑
 *   `pinyin(title, { type: 'all' })`——多音字 48 个、含多音字标题 71 个，
 *   人工逐条核对默认读音后，**误读站名 0 个**（≤5 阈值，只用 customPinyin
 *   名单，不引入 `@pinyin-pro/data`）。
 * - 本表 3 条是防御性钉死：三处最高频易错多音词，当前库默认读音已正确，
 *   钉死防止后续字典版本翻转；不是“纠错”条目。
 * - v3 API 说明：方案写的是 v2 形式 `customPinyin(word, pinyin)`；v3.29.5
 *   实测签名是 `customPinyin({ [word]: pinyin }, options)`（见
 *   `types/core/custom/index.d.ts`），本文件用对象形式，并传
 *   `{ polyphonic: 'add' }` 让修正读音同时进多音展开。
 */

export interface PinyinKeys {
  /** 全拼去空格，如 "daohang"（toneType:'none'，小写） */
  pyFull: string
  /** 首字母串，如 "dh"（pattern:'first', toneType:'none'，小写） */
  pyFirst: string
  /** 多音展开后的单字读音集合（type:'all' 的 polyphonic[]，去调、去重、小写） */
  polyphonic: string[]
}

/**
 * 修正名单：词 → 带调空格分隔读音（v3 customPinyin 对象形式的值格式）。
 * 误读站名 0 个；3 条均为防御性钉死（见文件头）。
 */
export const PINYIN_FIXES: Record<string, string> = {
  '长辈': 'zhǎng bèi',
  '出行': 'chū xíng',
  '校验': 'jiào yàn',
}

/** pinyin-pro v3 模块的最小结构类型（只用这两个 API；不静态 import 该包）。 */
type PinyinProModule = typeof import('pinyin-pro')

let pinyinPromise: Promise<PinyinProModule | null> | null = null
let pinyinImpl: PinyinProModule | null = null
let fixesApplied = false

/** pinyin-pro 是否已加载成功（拼音通道可用）。 */
export function isPinyinLoaded(): boolean {
  return pinyinImpl !== null
}

/**
 * 动态加载 pinyin-pro（§1.3）：Promise 缓存复用；失败置回 null 可重试，
 * 失败期间返回 false、拼音通道静默关闭，永不抛错到面板。
 */
export async function ensurePinyinLoaded(): Promise<boolean> {
  if (pinyinImpl) return true
  if (!pinyinPromise) {
    pinyinPromise = import('pinyin-pro')
      .then((mod) => {
        pinyinImpl = mod
        applyCustomPinyinFixes()
        return mod
      })
      .catch((err) => {
        pinyinPromise = null
        console.warn('[palette-pinyin] pinyin-pro 加载失败，拼音通道关闭，回落旧匹配', err)
        return null
      })
  }
  return (await pinyinPromise) !== null
}

/**
 * 库加载后、首次 `buildPinyinKeys` 前调一次（`ensurePinyinLoaded` 内已调；
 * 直接导出供单测调用）。`customPinyin` 失败时只记一次 warn，继续用默认读音。
 */
export function applyCustomPinyinFixes(): void {
  if (fixesApplied || !pinyinImpl) return
  fixesApplied = true
  try {
    pinyinImpl.customPinyin(PINYIN_FIXES, { polyphonic: 'add' })
  } catch (err) {
    console.warn('[palette-pinyin] customPinyin 修正失败，继续用默认读音', err)
  }
}

/** 去调：只去掉声调符号，保留 ü（与 toneType:'none' 的输出口径一致）。 */
function stripTone(pinyin: string): string {
  return pinyin.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, (m) => {
    switch (m) {
      case 'ā': case 'á': case 'ǎ': case 'à': return 'a'
      case 'ē': case 'é': case 'ě': case 'è': return 'e'
      case 'ī': case 'í': case 'ǐ': case 'ì': return 'i'
      case 'ō': case 'ó': case 'ǒ': case 'ò': return 'o'
      case 'ū': case 'ú': case 'ǔ': case 'ù': return 'u'
      case 'ǖ': case 'ǘ': case 'ǚ': case 'ǜ': return 'ü'
      default: return m
    }
  })
}

/**
 * 三组计算（§1.2，参数写死）：
 * - pyFull：`pinyin(title, { toneType: 'none', type: 'array' }).join('')`
 * - pyFirst：`pinyin(title, { pattern: 'first', toneType: 'none', type: 'array' }).join('')`
 * - polyphonic：`pinyin(title, { type: 'all' }).flatMap(c => c.polyphonic)`，去调、去重
 *
 * 未加载时抛错（调用方必须先 `await ensurePinyinLoaded()` 并在成功后才调；
 * 静默返回空键会让拼音查询无声漏命中，比抛错更难查）。
 */
export function buildPinyinKeys(title: string): PinyinKeys {
  if (!pinyinImpl) {
    throw new Error('[palette-pinyin] pinyin-pro 尚未加载：先 await ensurePinyinLoaded()')
  }
  const { pinyin } = pinyinImpl
  const pyFull = pinyin(title, { toneType: 'none', type: 'array' }).join('').toLowerCase()
  const pyFirst = pinyin(title, { pattern: 'first', toneType: 'none', type: 'array' })
    .join('')
    .toLowerCase()
  const polyphonic = [
    ...new Set(
      pinyin(title, { type: 'all' })
        .flatMap((c) => c.polyphonic ?? [])
        .map((p) => stripTone(p).toLowerCase())
        .filter(Boolean),
    ),
  ]
  return { pyFull, pyFirst, polyphonic }
}

/** 仅 [a-z0-9 ]（大小写不限，匹配前会小写）时 true；中文查询不是拉丁查询。 */
export function isLatinQuery(query: string): boolean {
  const q = query.trim()
  return q.length > 0 && /^[a-z0-9 ]+$/i.test(q)
}

function tokenScore(token: string, keys: PinyinKeys): number {
  const { pyFull, pyFirst, polyphonic } = keys
  // 全等命中：1.0（只认 pyFull / pyFirst；多音单字全等走前缀 0.85）
  if (token === pyFull || token === pyFirst) return 1.0
  let best = 0
  if (pyFull.startsWith(token)) best = Math.max(best, 0.9)
  else if (pyFull.includes(token)) best = Math.max(best, 0.7)
  if (pyFirst.startsWith(token)) best = Math.max(best, 0.8)
  else if (pyFirst.includes(token)) best = Math.max(best, 0.6)
  for (const p of polyphonic) {
    if (p.startsWith(token)) best = Math.max(best, 0.85)
    else if (p.includes(token)) best = Math.max(best, 0.65)
  }
  return best
}

/**
 * 拼音匹配分（§1.2，评分写死）：
 * - 中文查询直接返 0，不进拼音通道（中文走现有 matchToken 子串路径）。
 * - 查询按空白切 token，**每个 token 都必须命中**（与 matchSuggestionText
 *   的多词 AND 语义一致）；多 token 取各 token 分数的**乘积**。
 * - 单 token：pyFull 前缀 0.9 / 中间 0.7；pyFirst 前缀 0.8 / 中间 0.6；
 *   polyphonic 任一读音前缀 0.85 / 中间 0.65；全等 1.0；取最高一项。
 * - 返回 0 即不命中；>0 即命中，分数只用于本地行内部排序。
 */
export function matchPinyin(query: string, keys: PinyinKeys): number {
  if (!isLatinQuery(query)) return 0
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return 0
  let product = 1
  for (const token of tokens) {
    const score = tokenScore(token, keys)
    if (score === 0) return 0
    product *= score
  }
  return product
}
