#!/usr/bin/env node
/**
 * 标签数据护栏（2026-11-21 二期）。
 *
 * 为什么是「护栏」而不是「再清一遍」：一轮清洗后实测数据已经很干净——
 *   零标签站点 0 个、超长类目复读标签 0 个、异常 slug 0 个。
 * 此时再写一个「清理脚本」没有对象可清。真正有价值的是**防回归**：
 * 新增站点时最容易漏填 tags、最容易把分类名整段抄成标签。
 *
 * 本脚本只读不写，作为门禁使用（pnpm check:tags）。三条规则：
 *  1. 零标签站点：tags 缺失或为空数组。新增站点漏填标签是最高频的数据瑕疵，
 *     卡片上会变成空白标签区，观感与信息量双输。
 *  2. 超长标签：CJK 字符数 > 6 且不是已知英文/缩写词。这是「分类名复读」
 *     的早期信号（如 #大模型对话助手），在变成普遍现象前拦下来。
 *  3. 单卡包含关系：同一站点的两个标签互为子串（如 开源 / 开源框架）。
 *     单卡标签上限是 3，被包含的标签等于浪费一个位置。
 *     注意：clean-navigation-tags.mjs 能自动修这条，这里仅作残留检测。
 *
 * 用法：
 *   node scripts/check-tag-data.mjs            # 摘要
 *   node scripts/check-tag-data.mjs --strict   # 有任何违规即退出码 1（CI 用）
 *   node scripts/check-tag-data.mjs --json     # 机器可读
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const DEFAULT_NAV_PATH = resolve(
  REPO_ROOT,
  'apps/web-overlay/src/navsphere/content/navigation.json',
)

/** CJK 字符计数（与 clean-navigation-tags.mjs 的 countCjkChars 同口径）。 */
function countCjkChars(str) {
  let n = 0
  for (const ch of String(str)) {
    const code = ch.codePointAt(0)
    if (code >= 0x4e00 && code <= 0x9fff) n++
  }
  return n
}

/** 收集文档里全部站点（含一级直属与各子分类）。 */
function collectSites(doc) {
  const out = []
  const visitItems = (items, path) => {
    if (!Array.isArray(items)) return
    for (const item of items) {
      if (item && typeof item === 'object') out.push({ item, path })
    }
  }
  const roots = doc.navigationItems || doc
  if (!Array.isArray(roots)) return out
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue
    visitItems(root.items, [root.title].filter(Boolean))
    for (const sub of root.subCategories || []) {
      visitItems(sub?.items, [root.title, sub?.title].filter(Boolean))
    }
  }
  return out
}

export function auditTags(doc, { maxCjk = 6 } = {}) {
  const sites = collectSites(doc)
  const zeroTag = []
  const overlong = []
  const contained = []

  for (const { item, path } of sites) {
    const tags = Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string') : []
    const title = String(item.title ?? '(未命名)')

    if (tags.length === 0) {
      zeroTag.push({ title, path: path.join(' / ') })
      continue
    }

    for (const tag of tags) {
      if (countCjkChars(tag) > maxCjk) {
        overlong.push({ title, tag, cjk: countCjkChars(tag) })
      }
    }

    const lowered = tags.map((t) => String(t).toLowerCase())
    for (let i = 0; i < lowered.length; i++) {
      for (let j = i + 1; j < lowered.length; j++) {
        const a = lowered[i]
        const b = lowered[j]
        if (!a || !b || a === b) continue
        if (a.includes(b) || b.includes(a)) {
          contained.push({ title, a: tags[i], b: tags[j] })
        }
      }
    }
  }

  return { total: sites.length, zeroTag, overlong, contained }
}

function main(argv) {
  const strict = argv.includes('--strict')
  const json = argv.includes('--json')
  const fileArgIndex = argv.indexOf('--file')
  const file =
    fileArgIndex >= 0 && argv[fileArgIndex + 1] ? resolve(argv[fileArgIndex + 1]) : DEFAULT_NAV_PATH

  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const report = auditTags(doc)

  if (json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log('='.repeat(57))
    console.log(`[check-tag-data] ${file.replace(REPO_ROOT, '.')}`)
    console.log(`扫描站点: ${report.total}`)
    console.log(`  - 零标签站点:        ${report.zeroTag.length}`)
    console.log(`  - 超长标签(>6汉字):  ${report.overlong.length}`)
    console.log(`  - 单卡包含关系:      ${report.contained.length}`)
    if (report.zeroTag.length > 0) {
      console.log('\n--- 零标签站点 ---')
      for (const z of report.zeroTag.slice(0, 20)) console.log(`  [${z.path}] ${z.title}`)
      if (report.zeroTag.length > 20) console.log(`  …还有 ${report.zeroTag.length - 20} 个`)
    }
    if (report.overlong.length > 0) {
      console.log('\n--- 超长标签 ---')
      for (const o of report.overlong.slice(0, 20)) console.log(`  ${o.title}: #${o.tag} (${o.cjk} 汉字)`)
    }
    if (report.contained.length > 0) {
      console.log('\n--- 单卡包含关系（可用 clean-navigation-tags.mjs 自动修） ---')
      for (const c of report.contained.slice(0, 20)) console.log(`  ${c.title}: #${c.a} / #${c.b}`)
    }
    console.log('='.repeat(57))
  }

  const violations = report.zeroTag.length + report.overlong.length + report.contained.length
  if (strict && violations > 0) {
    console.error(`[check-tag-data] --strict：发现 ${violations} 处标签数据违规`)
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('check-tag-data.mjs')) {
  main(process.argv.slice(2))
}
