#!/usr/bin/env node
/**
 * 导航站标签数据治理与清洗脚本（支持 --dry-run 预览 diff 与 --write 落盘）。
 *
 * 治理规则（与 apps/web-overlay/src/lib/tag-hygiene.ts 同源口径）：
 *  1. 剔除分类重复标签：自动检测并移除与所属一级/二级分类名称相似度 > 70% 的标签，
 *     以及未映射到标准词的连字符机器化 slug（如 #ai-音频与语音、#向量库与-rag-应用、#ai-安全与对齐研究）；
 *  2. 同义词归一化字典：将同义变体归并为简短标准词（如 `视频生成` / `AI视频` → `AI视频`，
 *     `ai-编程` / `agentic-ide` → `AI编程`），消除分类头与卡片内的同义重复；
 *  3. 强化正交决策属性标签：优先保留并基于确定性信号（pricing-overrides.json + 描述/域名强信号）
 *     提取高价值决策标签（开源、免费额度、免费、国产直连、需魔法、支持 API、自托管、企业级），
 *     单卡严格控制在最多 3 个标签，每标签简洁可读（中文 ≤ 5 字）。
 *
 * 用法：
 *   node scripts/clean-navigation-tags.mjs --dry-run
 *   node scripts/clean-navigation-tags.mjs --write
 *   node scripts/clean-navigation-tags.mjs --dry-run --file apps/web-overlay/src/navsphere/content/navigation.json
 *   node scripts/clean-navigation-tags.mjs --dry-run --json-report tmp/tag-clean-report.json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

export const DEFAULT_NAV_PATH = resolve(
  REPO_ROOT,
  'apps/web-overlay/src/navsphere/content/navigation.json',
)
export const PRICING_OVERRIDES_PATH = resolve(
  REPO_ROOT,
  'packages/core/src/pricing-overrides.json',
)

export const SPECIAL_TAG_MAPPING = {
  'c#': 'csharp',
  'c++': 'cpp',
  '.net': 'dotnet',
  'node.js': 'nodejs',
  'vue.js': 'vuejs',
}

export const TAG_SYNONYM_MAP = {
  'ai视频': 'AI视频',
  '视频生成': 'AI视频',
  'ai视频生成': 'AI视频',
  '文生视频': 'AI视频',
  'ai音乐': 'AI音乐',
  '音乐生成': 'AI音乐',
  'ai作曲': 'AI音乐',
  'ai绘图': 'AI绘图',
  'ai绘画': 'AI绘图',
  '图像生成': 'AI绘图',
  '文生图': 'AI绘图',
  'ai编程': 'AI编程',
  '编程助手': 'AI编程',
  '代码助手': 'AI编程',
  'agenticide': 'AI编程',
  'ai搜索': 'AI搜索',
  '智能搜索': 'AI搜索',
  'ai配音': 'AI配音',
  '语音合成': 'AI配音',
  'ai语音': 'AI配音',
  'tts': 'AI配音',
  'ai短剧': '短剧',
  '短剧创作': '短剧',
  '大语言模型': '大模型',
  'llm': '大模型',
  'ui设计': 'UI设计',
  '云文档': '在线文档',
  '开源免费': '开源',
  'opensource': '开源',
  '免费版': '免费额度',
  '免费试用': '免费额度',
  'freemium': '免费额度',
  '国内直连': '国产直连',
  '国内可用': '国产直连',
  '免翻墙': '国产直连',
  '需代理': '需魔法',
  '需翻墙': '需魔法',
  '科学上网': '需魔法',
  'api': '支持 API',
  'api接口': '支持 API',
  '开放api': '支持 API',
  '私有部署': '自托管',
  '本地部署': '自托管',
  'selfhosted': '自托管',
  '企业版': '企业级',
}

export const ORTHOGONAL_ATTRIBUTE_TAGS = [
  '开源',
  '免费额度',
  '免费',
  '国产直连',
  '需魔法',
  '支持 API',
  '自托管',
  '企业级',
  '本地优先',
]

const ORTHOGONAL_PRIORITY_MAP = new Map(
  ORTHOGONAL_ATTRIBUTE_TAGS.map((tag, idx) => [normalizeTag(tag), idx]),
)

const GENERIC_TAG_DENYLIST = new Set(['ai赋能'])

export function normalizeTag(value) {
  const raw = String(value || '').trim().replace(/^#+/, '').toLowerCase()
  if (SPECIAL_TAG_MAPPING[raw]) return SPECIAL_TAG_MAPPING[raw]
  return raw.replace(/[\s\-_/·、，,]+/g, '')
}

export function canonicalizeTag(raw) {
  const trimmed = String(raw || '').trim().replace(/^#+/, '').trim()
  if (!trimmed) return ''
  const key = normalizeTag(trimmed)
  if (!key) return ''
  return TAG_SYNONYM_MAP[key] ?? trimmed
}

export function isHyphenatedSlugTag(raw) {
  const trimmed = String(raw || '').trim().replace(/^#+/, '').trim()
  if (!trimmed || !trimmed.includes('-')) return false
  if (/[\u4e00-\u9fff]/.test(trimmed)) return true
  const hyphenCount = (trimmed.match(/-/g) || []).length
  return hyphenCount >= 2
}

export function computeTagSimilarity(a, b) {
  const na = normalizeTag(a)
  const nb = normalizeTag(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.length < 2 || nb.length < 2) return 0

  const bigramsA = new Map()
  for (let i = 0; i < na.length - 1; i++) {
    const bg = na.slice(i, i + 2)
    bigramsA.set(bg, (bigramsA.get(bg) || 0) + 1)
  }
  let intersection = 0
  const totalB = nb.length - 1
  for (let i = 0; i < totalB; i++) {
    const bg = nb.slice(i, i + 2)
    const count = bigramsA.get(bg) || 0
    if (count > 0) {
      intersection++
      bigramsA.set(bg, count - 1)
    }
  }
  return (2 * intersection) / (na.length - 1 + totalB)
}

/** 统计汉字个数（用于判定是否超过 5 个汉字的冗长标签） */
function countCjkChars(str) {
  return (String(str).match(/[\u4e00-\u9fff]/g) || []).length
}

/** 归一化 URL 键，与 packages/core/src/pricing-overrides.json 对齐 */
function normalizeHrefKey(href) {
  if (!href || typeof href !== 'string') return ''
  return href
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

function loadPricingMap() {
  if (!existsSync(PRICING_OVERRIDES_PATH)) return new Map()
  try {
    const raw = JSON.parse(readFileSync(PRICING_OVERRIDES_PATH, 'utf8'))
    const map = new Map()
    const entries = raw?.entries && typeof raw.entries === 'object' ? raw.entries : raw
    for (const [key, val] of Object.entries(entries || {})) {
      if (key.startsWith('$') || key.startsWith('_')) continue
      const pricing = typeof val === 'string' ? val : val?.value || val?.pricing
      if (pricing) map.set(normalizeHrefKey(key), pricing)
    }
    return map
  } catch {
    return new Map()
  }
}

/**
 * 基于高置信度结构化信号提取正交决策属性标签（绝不凭空编造）。
 */
export function extractOrthogonalSignals(item, pricingMap) {
  const extracted = []
  const hrefKey = normalizeHrefKey(item?.href)
  const desc = String(item?.description || '')
  const pricing = pricingMap?.get(hrefKey)

  if (pricing === 'open_source' || /\bopen[- ]?source\b|开源/i.test(desc)) {
    extracted.push('开源')
  }
  if (pricing === 'freemium' || /免费额度|免费试用|免费版/i.test(desc)) {
    extracted.push('免费额度')
  } else if (pricing === 'free') {
    extracted.push('免费')
  }
  if (/自托管|私有化?部署|本地部署|self[- ]?hosted/i.test(desc)) {
    extracted.push('自托管')
  }
  if (/\bapi\b|开放平台/i.test(desc)) {
    extracted.push('支持 API')
  }
  if (/企业级|企业版/i.test(desc)) {
    extracted.push('企业级')
  }
  return extracted
}

/**
 * 清洗单个站点的标签数组，返回清洗结果与结构化审计明细。
 */
export function cleanSiteItemTags(item, categoryTitles, options = {}) {
  const {
    maxTags = 3,
    similarityThreshold = 0.7,
    extractOrthogonal = true,
    pricingMap = new Map(),
  } = options

  const rawTags = Array.isArray(item?.tags) ? item.tags.filter((t) => typeof t === 'string') : []
  const catNormalized = categoryTitles.map((t) => normalizeTag(t)).filter(Boolean)

  const removedCategoryDuplicates = []
  const slugFixes = []
  const synonymMerges = []
  const removedVerbose = []
  /** 单卡包含关系去重记录（二期新增）：短标签被更具体的长标签吸收。 */
  const containedMerges = []
  const seen = new Set()
  const kept = []

  const matchesCategory = (candidate) => {
    const key = normalizeTag(candidate)
    if (!key) return { hit: true, matched: '', score: 1 }
    for (let i = 0; i < catNormalized.length; i++) {
      const catKey = catNormalized[i]
      const score = computeTagSimilarity(key, catKey)
      if (score > similarityThreshold) {
        return { hit: true, matched: categoryTitles[i], score }
      }
    }
    return { hit: false, matched: '', score: 0 }
  }

  for (const raw of rawTags) {
    const trimmed = raw.trim().replace(/^#+/, '').trim()
    if (!trimmed) continue
    const rawKey = normalizeTag(trimmed)
    if (!rawKey || GENERIC_TAG_DENYLIST.has(rawKey)) {
      removedCategoryDuplicates.push({ tag: raw, reason: '泛化黑名单' })
      continue
    }

    const isSlug = isHyphenatedSlugTag(trimmed)
    const canonical = canonicalizeTag(trimmed)
    const canonicalKey = normalizeTag(canonical)

    // 1. 先检查与所属一级/二级分类相似度 > 70%
    const catCheckRaw = matchesCategory(trimmed)
    const catCheckCanonical = matchesCategory(canonical)
    if (catCheckRaw.hit || catCheckCanonical.hit) {
      const hit = catCheckRaw.hit ? catCheckRaw : catCheckCanonical
      removedCategoryDuplicates.push({
        tag: raw,
        matchedCategory: hit.matched,
        similarity: Number(hit.score.toFixed(2)),
      })
      if (isSlug) {
        slugFixes.push({ site: item.title, from: raw, to: null, action: 'removed_category_slug' })
      }
      continue
    }

    // 2. 连字符机器化 slug：若命中同义词表则规范化，否则剔除
    if (isSlug) {
      if (TAG_SYNONYM_MAP[rawKey]) {
        slugFixes.push({ site: item.title, from: raw, to: canonical, action: 'normalized_slug' })
      } else {
        slugFixes.push({ site: item.title, from: raw, to: null, action: 'removed_slug' })
        continue
      }
    }

    // 3. 过滤冗长句子化标签（汉字 > 5 且非正交属性词）
    if (countCjkChars(canonical) > 5 && !ORTHOGONAL_PRIORITY_MAP.has(canonicalKey)) {
      removedVerbose.push(raw)
      continue
    }

    // 4. 同义词归并记录
    if (canonical !== trimmed && !isSlug) {
      synonymMerges.push({ from: raw, to: canonical })
    }

    if (seen.has(canonicalKey)) {
      synonymMerges.push({ from: raw, to: canonical, deduplicated: true })
      continue
    }

    /**
     * 4b. 单卡同义包含去重（2026-11-21 二期）。
     *
     * seen 只做「完全相等」去重，挡不住包含关系：实测库里仍有 6 对，
     * 例如「开源 / 开源框架」「AI思维导图 / 思维导图」「简历 / 简历模板」。
     * 两张标签并存时，同一张卡上「开源」与「开源框架」占掉两个宝贵的标签位
     * （单卡上限 3），信息密度反而下降。
     *
     * 规则：短标签是长标签的子串时，**保留长标签**（信息量更大），
     * 但短标签若是正交决策属性（开源/免费额度/自托管…）则反过来保留它——
     * 决策属性是跨站可比的一等公民，不能因为某个站多了个「开源框架」就丢掉。
     */
    const containMatch = kept.find((existing) => {
      const ek = normalizeTag(existing)
      if (!ek || ek === canonicalKey) return false
      return ek.includes(canonicalKey) || canonicalKey.includes(ek)
    })
    if (containMatch) {
      const matchKey = normalizeTag(containMatch)
      const keepExistingIsOrthogonal = ORTHOGONAL_PRIORITY_MAP.has(matchKey)
      const keepNewIsOrthogonal = ORTHOGONAL_PRIORITY_MAP.has(canonicalKey)
      // 两边都是（或都不是）决策属性时，留更长的那个；仅在「一边是决策属性」时优先它
      const preferExisting =
        keepExistingIsOrthogonal !== keepNewIsOrthogonal
          ? keepExistingIsOrthogonal
          : matchKey.length >= canonicalKey.length
      if (preferExisting) {
        containedMerges.push({ from: raw, to: containMatch, reason: 'contained_substring' })
        continue
      }
      // 新标签更该留：把旧的从 kept 里摘掉
      kept.splice(kept.indexOf(containMatch), 1)
      seen.delete(matchKey)
      containedMerges.push({ from: containMatch, to: canonical, reason: 'contained_substring' })
    }

    seen.add(canonicalKey)
    kept.push(canonical)
  }

  // 5. 若启用确定性正交属性强化，先并入高置信度正交决策信号，再统一排序并截断至 maxTags
  const addedOrthogonal = []
  if (extractOrthogonal) {
    const signals = extractOrthogonalSignals(item, pricingMap)
    for (const sig of signals) {
      const key = normalizeTag(sig)
      if (seen.has(key)) continue
      // 避免同时出现「免费」与「免费额度」
      if (sig === '免费' && seen.has(normalizeTag('免费额度'))) continue
      if (sig === '免费额度' && seen.has(normalizeTag('免费'))) continue
      seen.add(key)
      kept.push(sig)
      addedOrthogonal.push(sig)
    }
  }

  // 6. 正交决策属性优先排序并截断至 maxTags（默认 3）
  kept.sort((a, b) => {
    const pa = ORTHOGONAL_PRIORITY_MAP.get(normalizeTag(a)) ?? Number.POSITIVE_INFINITY
    const pb = ORTHOGONAL_PRIORITY_MAP.get(normalizeTag(b)) ?? Number.POSITIVE_INFINITY
    return pa - pb
  })

  const finalTags = kept.slice(0, maxTags)
  const changed =
    finalTags.length !== rawTags.length || finalTags.some((t, i) => t !== rawTags[i])

  return {
    before: rawTags,
    after: finalTags,
    changed,
    removedCategoryDuplicates,
    slugFixes,
    synonymMerges,
    removedVerbose,
    addedOrthogonal,
    containedMerges,
  }
}

function collectCategoryHeaderTags(items) {
  const counts = new Map()
  for (const item of items) {
    for (const t of item.tags || []) {
      const trimmed = String(t || '').trim()
      if (!trimmed) continue
      counts.set(trimmed, (counts.get(trimmed) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag, count]) => `${tag}(${count})`)
}

/**
 * 清洗整份 navigation.json 数据结构（纯函数，返回新对象与完整审计报告）。
 */
export function cleanNavigationDocument(doc, options = {}) {
  const pricingMap = options.pricingMap ?? loadPricingMap()
  const cloned = structuredClone(doc)

  const stats = {
    totalSites: 0,
    modifiedSites: 0,
    tagsBefore: 0,
    tagsAfter: 0,
    categoryDuplicateRemoved: 0,
    synonymMergesCount: 0,
    slugFixedCount: 0,
    slugRemovedCount: 0,
    verboseRemovedCount: 0,
    orthogonalAddedCount: 0,
    /** 单卡包含关系去重（二期）：短标签被更具体的长标签吸收的次数。 */
    containedMergesCount: 0,
  }
  const slugFixList = []
  const siteDiffs = []
  const categoryHeaderDiffs = []

  for (const rootCat of cloned.navigationItems || []) {
    const allItemsBefore = []
    const allItemsAfter = []

    const processItem = (item, titles) => {
      stats.totalSites++
      const beforeTags = Array.isArray(item.tags) ? [...item.tags] : []
      allItemsBefore.push({ tags: beforeTags })
      const res = cleanSiteItemTags(item, titles, { ...options, pricingMap })
      stats.tagsBefore += res.before.length
      stats.tagsAfter += res.after.length
      stats.categoryDuplicateRemoved += res.removedCategoryDuplicates.length
      stats.synonymMergesCount += res.synonymMerges.length
      stats.verboseRemovedCount += res.removedVerbose.length
      stats.orthogonalAddedCount += res.addedOrthogonal.length
    stats.containedMergesCount += res.containedMerges.length

      for (const fix of res.slugFixes) {
        slugFixList.push(fix)
        if (fix.to) stats.slugFixedCount++
        else stats.slugRemovedCount++
      }

      if (res.changed) {
        stats.modifiedSites++
        item.tags = res.after
        siteDiffs.push({
          category: titles.join(' / '),
          title: item.title,
          before: res.before,
          after: res.after,
          removedCategoryDuplicates: res.removedCategoryDuplicates,
          synonymMerges: res.synonymMerges,
          addedOrthogonal: res.addedOrthogonal,
          containedMerges: res.containedMerges,
        })
      }
      allItemsAfter.push({ tags: Array.isArray(item.tags) ? item.tags : [] })
    }

    for (const item of rootCat.items || []) {
      processItem(item, [rootCat.title].filter(Boolean))
    }
    for (const subCat of rootCat.subCategories || []) {
      const titles = [rootCat.title, subCat.title].filter(Boolean)
      for (const item of subCat.items || []) {
        processItem(item, titles)
      }
    }

    const headerBefore = collectCategoryHeaderTags(allItemsBefore)
    const headerAfter = collectCategoryHeaderTags(allItemsAfter)
    if (headerBefore.join('|') !== headerAfter.join('|')) {
      categoryHeaderDiffs.push({
        category: rootCat.title,
        before: headerBefore,
        after: headerAfter,
      })
    }
  }

  return {
    cleaned: cloned,
    report: {
      stats,
      slugFixList,
      categoryHeaderDiffs,
      siteDiffs,
    },
  }
}

function parseArgs(argv) {
  const args = {
    write: false,
    dryRun: true,
    file: DEFAULT_NAV_PATH,
    extractOrthogonal: true,
    jsonReport: null,
    limit: 25,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--write') {
      args.write = true
      args.dryRun = false
    } else if (a === '--dry-run') {
      args.dryRun = true
      args.write = false
    } else if (a === '--file' && argv[i + 1]) {
      args.file = resolve(process.cwd(), argv[++i])
    } else if (a === '--no-extract-orthogonal') {
      args.extractOrthogonal = false
    } else if (a === '--json-report' && argv[i + 1]) {
      args.jsonReport = resolve(process.cwd(), argv[++i])
    } else if (a === '--limit' && argv[i + 1]) {
      args.limit = Number(argv[++i]) || 25
    }
  }
  return args
}

function printReport(file, report, mode, limit) {
  const { stats, slugFixList, categoryHeaderDiffs, siteDiffs } = report
  console.log(`\n================ 标签清洗报告 (${mode}) ================`)
  console.log(`目标文件: ${file}`)
  console.log(`扫描站点: ${stats.totalSites} | 发生变更: ${stats.modifiedSites}`)
  console.log(`标签总数: ${stats.tagsBefore} -> ${stats.tagsAfter}`)
  console.log(`  - 分类重复/相似度>70% 剔除: ${stats.categoryDuplicateRemoved}`)
  console.log(`  - 同义词归并/去重次数:      ${stats.synonymMergesCount}`)
  console.log(`  - 异常 slug 归一化修复:     ${stats.slugFixedCount}`)
  console.log(`  - 异常 slug 直接剔除:       ${stats.slugRemovedCount}`)
  console.log(`  - 冗长标签(>5汉字)剔除:     ${stats.verboseRemovedCount}`)
  console.log(`  - 正交决策属性标签补齐:     ${stats.orthogonalAddedCount}`)
  console.log(`  - 单卡包含关系去重(二期):   ${stats.containedMergesCount}`)

  if (slugFixList.length > 0) {
    console.log(`\n--- 异常连字符 Slug 修复/剔除清单 (${slugFixList.length} 处) ---`)
    for (const fix of slugFixList) {
      const target = fix.to ? `-> #${fix.to}` : '-> [已剔除]'
      console.log(`  [${fix.site}] #${fix.from} ${target} (${fix.action})`)
    }
  }

  if (categoryHeaderDiffs.length > 0) {
    console.log(`\n--- 分类头热门标签变化 (${categoryHeaderDiffs.length} 个分类) ---`)
    for (const diff of categoryHeaderDiffs) {
      console.log(`  [${diff.category}]`)
      console.log(`    前: ${diff.before.join(', ') || '(无)'}`)
      console.log(`    后: ${diff.after.join(', ') || '(无)'}`)
    }
  }

  if (siteDiffs.length > 0) {
    const shown = siteDiffs.slice(0, limit)
    console.log(`\n--- 站点标签 Diff 预览（展示前 ${shown.length}/${siteDiffs.length} 条）---`)
    for (const d of shown) {
      console.log(`  [${d.category}] ${d.title}`)
      console.log(`    - ${d.before.map((t) => `#${t}`).join(' ') || '(空)'}`)
      console.log(`    + ${d.after.map((t) => `#${t}`).join(' ') || '(空)'}`)
    }
  }
  console.log('=========================================================\n')
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.file)) {
    console.error(`[clean-navigation-tags] 文件不存在: ${args.file}`)
    process.exit(1)
  }
  const rawDoc = JSON.parse(readFileSync(args.file, 'utf8'))
  const { cleaned, report } = cleanNavigationDocument(rawDoc, {
    extractOrthogonal: args.extractOrthogonal,
  })
  printReport(args.file, report, args.write ? 'WRITE' : 'DRY-RUN', args.limit)

  if (args.jsonReport) {
    writeFileSync(args.jsonReport, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`[clean-navigation-tags] 已输出 JSON 报告: ${args.jsonReport}`)
  }

  if (args.write) {
    writeFileSync(args.file, JSON.stringify(cleaned, null, 2) + '\n', 'utf8')
    console.log(`[clean-navigation-tags] 已写入清洗结果: ${args.file}`)
  } else {
    console.log('[clean-navigation-tags] 当前为 dry-run 预览模式，未修改任何文件；加 --write 可正式落盘。')
  }
}
