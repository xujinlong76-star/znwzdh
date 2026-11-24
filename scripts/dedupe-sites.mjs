#!/usr/bin/env node
/**
 * 全库重复站点检测与安全合并脚本（默认 --dry-run，只读预览不改库）。
 *
 * 规则体系（3 条高精度零误伤规则）：
 *  1. url_exact：规范化主域 + 路径 + 有效查询串完全相同（忽略 http/https、www.、末尾 /、常见跟踪参数与空 hash）；
 *  2. same_subcat_name：同子分类下核心名称一致 / 伴生文档与开源仓库副本 / 品牌+域名互证（如 Midjourney ×2、可灵 AI vs 快手可灵 (Kling AI)、Prompt Engineering Guide vs (DAIR)、Next.js vs Next.js 官方架构指南、SvelteKit vs SvelteKit 官方手册、MDN WebExtensions vs WebExtensions API (MDN)、Dive vs Dive 开源仓库），同时严格隔离独立子产品（如 Docker vs Docker Hub、MySQL vs MySQL MCP Server、YouTube vs YouTube Studio、不同大厂同名垂直服务）；
 *  3. same_subcat_locale_or_docs：同子分类下同站多语言文档路径镜像（en-US / zh-CN 等）或同域官网根路径与 /docs 官方文档页重复。
 *
 * 合并策略（仅在显式传入 --apply 时执行，且自动在 data/backups/ 落全量备份）：
 *  - 按「状态健康度 > 用户收藏/访问/权重 > 元数据完整度 > 官方主域与标准标题优先」综合打分选出主记录；
 *  - 合并副记录的差异有效标签（site_tags）、立面（site_facets）与缺失元数据（英文标题/简介/图标等），累加 visit_count；
 *  - 安全迁移全部外键关联（favorites / collection_items / events / site_relations / health_checks / site_radar / site_prices / user_profiles 等）；
 *  - 在 site_id_aliases 表与 app_settings['site_id_redirects'] 写入 old_site_id → canonical_site_id 映射，避免老收藏 /site/{id} 变 404；
 *  - 事务内删除副记录（同步触发 sites_fts / sites_substr / data_version 清理），保证检索无幽灵残影。
 *
 * 用法：
 *   node scripts/dedupe-sites.mjs --dry-run              # 预览报告（默认）
 *   node scripts/dedupe-sites.mjs --dry-run --json       # 另导出 JSON 报告到 stdout
 *   node scripts/dedupe-sites.mjs --dry-run --out report.json
 *   node scripts/dedupe-sites.mjs --apply                # 自动备份后在单事务内执行安全合并
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const dbPath = process.env.NAVHUB_SQLITE_PATH || resolve(rootDir, 'data/navhub.db')

const args = new Set(process.argv.slice(2))
const isApply = args.has('--apply')
const isJsonStdout = args.has('--json')
const outIdx = process.argv.indexOf('--out')
const outPath = outIdx !== -1 ? process.argv[outIdx + 1] : null

/* ------------------------------------------------------------------ *
 * 1. URL 规范化（规则 1 & 规则 3）
 * ------------------------------------------------------------------ */

const TRACKING_PARAMS = new Set([
  'ref', 'referrer', 'source', 'from', 'spm', 'fbclid', 'gclid', 'msclkid', 'yclid',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'igshid', 'share_id', 'share_source',
  'via', 'channel', 'si', 'trk', 'campaign', 'feature', 'hl', 'lang', 'locale',
  'ref_src', 'ref_url', 's', 't', 'ved', 'ei', 'sa', 'usg', 'scid', 'share',
])

export function canonicalizeUrlForDedupe(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return ''
  const trimmed = rawUrl.trim()
  if (!trimmed) return ''
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const u = new URL(withProto)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    let pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
    const caseSensitiveHost = /(^|\.)(youtube\.com|youtu\.be|bit\.ly|t\.co|tinyurl\.com|b23\.tv)$/i.test(host)
    if (!caseSensitiveHost) pathname = pathname.toLowerCase()
    if (pathname === '/index.html' || pathname === '/index.htm' || pathname === '/index.php') {
      pathname = ''
    }

    const keptParams = []
    for (const [k, v] of u.searchParams.entries()) {
      const kl = k.toLowerCase()
      if (kl.startsWith('utm_') || TRACKING_PARAMS.has(kl)) continue
      keptParams.push([kl, v])
    }
    keptParams.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
    const query = keptParams.length > 0
      ? '?' + keptParams.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : ''
    return `${host}${pathname}${query}`
  } catch {
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, '')
      .replace(/#.*$/, '')
      .replace(/\/+$/, '')
  }
}

/** 去除常见语言前缀（/en-us/、/zh-cn/、/en/、/zh/ 等），用于检测同站多语言文档镜像 */
export function stripLocalePathKey(rawUrl) {
  const canon = canonicalizeUrlForDedupe(rawUrl)
  if (!canon) return ''
  const slash = canon.indexOf('/')
  if (slash === -1) return canon
  const host = canon.slice(0, slash)
  const rest = canon.slice(slash)
  const stripped = rest
    .replace(/^\/(en-us|en-gb|zh-cn|zh-hans|zh-hant|zh-tw|zh-hk|en|zh|ja|ko|fr|de|es|ru|pt-br)(?=\/|$)/i, '')
    .replace(/\/+$/, '')
  return `${host}${stripped}`
}

export function extractHostInfo(rawUrl) {
  try {
    const u = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    const parts = host.split('.')
    const twoPartTld = /\.(com|net|org|gov|edu|co|ac)\.(cn|uk|jp|au|hk|tw|sg)$/i.test(host)
    const apex = parts.length >= (twoPartTld ? 3 : 2)
      ? parts.slice(-(twoPartTld ? 3 : 2)).join('.')
      : host
    const pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase()
    const isGitHost = host === 'github.com' || host === 'gitlab.com' || host === 'gitee.com'
    return { host, apex, pathname, isGithub: host === 'github.com', isGitHost }
  } catch {
    return { host: '', apex: '', pathname: '', isGithub: false, isGitHost: false }
  }
}

/* ------------------------------------------------------------------ *
 * 2. 名称规范化与同子分类查重（规则 2）
 * ------------------------------------------------------------------ */

/** 明确属于「同产品文档/官网/中文伴生后缀」（不含 repo，repo 仅在 git 托管域名下剥离） */
const DOC_COMPANION_SUFFIX_RE = new RegExp(
  '(?:\\s*[-—–·/|:]\\s*|\\s+)*' +
    '(?:' +
    '官方架构指南|官方参考文档|官方中文文档|官方文档站|官方技术文档|官方文档|官方手册|官方指南|官方教程|官方站点|官方网站|官方主页|官方仓库|官方版|官网入口|官网|' +
    '中文官方文档|中文文档|中文手册|中文指南|中文教程|中文站|中文网|中文版|' +
    '架构指南|架构手册|参考文档|开发文档|开发指南|技术文档|使用指南|使用手册|快速入门|参考手册|' +
    'documentation|official\\s+docs?|official\\s+guide|official\\s+site|web\\s+docs|docs|documentation' +
    ')\\s*$',
  'i',
)

/** 开源代码仓库伴生后缀（仅对 GitHub/GitLab/Gitee 站点生效，避免误伤 Design Systems Repo 等独立站点） */
const REPO_COMPANION_SUFFIX_RE = new RegExp(
  '(?:\\s*[-—–·/|:]\\s*|\\s+)*' +
    '(?:开源仓库|源码仓库|代码仓库|项目仓库|github\\s*仓库|repository|repo|github)\\s*$',
  'i',
)

/** 严格限定的纯修饰词（绝不含 hub / studio / cloud / server / mcp / wiki / store / workspace 等实质产品词） */
const PURE_COMPANION_TOKENS = new Set([
  'ai', 'api', 'official', 'docs', 'doc', 'documentation', 'guide', 'manual', 'handbook',
  'github', 'official', 'web', 'site',
  '官方', '官网', '文档', '手册', '指南', '教程', '架构', '参考', '开源', '仓库', '源码', '中文', '中文版',
])

/** 母公司前缀：仅允许「一方带前缀、另一方不带前缀 + 域名品牌词根互证」时剥离，彻底杜绝百度健康 vs 阿里健康等误伤 */
const VENDOR_PREFIXES = ['快手', '字节跳动', '字节', '阿里', '阿里云', '腾讯', '百度', '网易', '华为', '小米', '美团', '京东', '智谱', '月之暗面']

/** 通用/泛化核心词黑名单（永不单独触发合并） */
const GENERIC_CORE_BLOCKLIST = new Set([
  'ai', 'ml', 'ui', 'ux', 'js', 'ts', 'go', 'rs', 'py', 'db', 'os', 'io', 'tv', 'cn',
  'api', 'sdk', 'cli', 'ide', 'css', 'svg', 'sql', 'git', 'dev', 'doc', 'docs', 'web',
  'app', 'pro', 'hub', 'lab', 'chat', 'code', 'data', 'cloud', 'tools', 'tool', 'news',
  'blog', 'wiki', 'video', 'music', 'image', 'photo', 'search', 'design', 'learn',
  '工具', '文档', '指南', '手册', '教程', '社区', '官网', '平台', '插件', '导航', '资源', '开源',
  '健康', '商城', '地图', '网盘', '输入法', '翻译', '直播', '游戏', '游戏中心', '云游戏', '招聘', '新闻',
])

function stripBrackets(str) {
  return str
    .replace(/\([^)]*\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/【[^】]*】/g, ' ')
}

function extractBracketContents(str) {
  const matches = []
  const re = /[（(\[【]([^）)\]】]+)[）)\]】]/g
  let m
  while ((m = re.exec(str)) !== null) {
    if (m[1]) matches.push(m[1].trim())
  }
  return matches
}

/** 提取标题的核心产品名（剥离括号说明 + 伴生修饰后缀，按是否 git 仓库决定是否剥离仓库后缀） */
export function normalizeCoreTitle(rawTitle, rawUrl = '') {
  if (!rawTitle || typeof rawTitle !== 'string') return ''
  const { isGitHost } = extractHostInfo(rawUrl)
  let s = stripBrackets(rawTitle).trim()
  for (let i = 0; i < 3; i++) {
    let next = s.replace(DOC_COMPANION_SUFFIX_RE, '').trim()
    if (isGitHost) {
      next = next.replace(REPO_COMPANION_SUFFIX_RE, '').trim()
    }
    if (next === s || !next) break
    s = next
  }
  s = s.replace(/[\s\-—–·/|:：,，.。]+$/, '').trim()
  return s.toLowerCase().replace(/\s+/g, ' ')
}

function compactKey(s) {
  return s.toLowerCase().replace(/[\s\-_.'’"“”·/|:：,，。!！?？]+/g, '')
}

function tokenizeSimple(str) {
  const lower = str.toLowerCase()
  const tokens = []
  const re = /[a-z0-9]+(?:[.#+][a-z0-9]+)*|[\u4e00-\u9fa5]{2,}/g
  let m
  while ((m = re.exec(lower)) !== null) {
    tokens.push(m[0])
  }
  return tokens
}

function hasCompanionSuffix(rawTitle, rawUrl = '') {
  const { isGitHost } = extractHostInfo(rawUrl)
  const bare = stripBrackets(rawTitle).trim()
  if (DOC_COMPANION_SUFFIX_RE.test(bare)) return true
  if (isGitHost && REPO_COMPANION_SUFFIX_RE.test(bare)) return true
  if (extractBracketContents(rawTitle).length > 0) return true
  return false
}

/** 识别单独成项的 MCP Server 适配器仓库（不能并入主数据库/主框架） */
function isStandaloneMcpServer(site) {
  const { isGitHost } = extractHostInfo(site.url)
  return isGitHost && /\bmcp\s*server\b|mcp[-_]?server/i.test(`${site.title} ${site.url}`)
}

/** 从 URL 主域与 GitHub repo 提取品牌词根（如 klingai.com -> klingai，klingai.kuaishou.com -> klingai） */
function hostBrandTokens(rawUrl) {
  const { host, pathname, isGithub } = extractHostInfo(rawUrl)
  const stop = new Set([
    'com', 'org', 'net', 'dev', 'app', 'gov', 'edu', 'www', 'docs', 'doc', 'blog',
    'help', 'api', 'cloud', 'github', 'gitlab', 'gitee', 'vercel', 'netlify', 'pages',
    'mozilla', 'developer', 'kuaishou', 'google', 'microsoft', 'baidu', 'qq', '163',
    'aliyun', 'taobao', 'alibaba', 'tencent', 'xiaomi', 'huawei', 'openai',
  ])
  const tokens = new Set()
  if (host) {
    for (const seg of host.split('.')) {
      if (seg.length >= 3 && !stop.has(seg)) tokens.add(seg)
    }
  }
  if (isGithub && pathname) {
    const parts = pathname.split('/').filter(Boolean)
    if (parts[1] && parts[1].length >= 3) {
      tokens.add(parts[1].replace(/[-_]/g, ''))
    }
  }
  return tokens
}

/** 检测标题头部是否带有母公司前缀（返回 { vendor, rest }） */
function splitVendorPrefix(titleBare) {
  const trimmed = titleBare.trim()
  for (const vp of VENDOR_PREFIXES) {
    if (trimmed.startsWith(vp) && trimmed.length - vp.length >= 2) {
      return { vendor: vp, rest: trimmed.slice(vp.length).trim() }
    }
  }
  return { vendor: null, rest: trimmed }
}

/** 判定两条同子分类站点是否属于高置信、零误伤重复对 */
export function classifySameSubcatPair(a, b) {
  // 独立 MCP Server 开源仓库绝不并入主产品（例如 MySQL vs MySQL MCP Server、Qdrant vs Qdrant MCP Server）
  if (isStandaloneMcpServer(a) !== isStandaloneMcpServer(b)) return null

  const coreA = normalizeCoreTitle(a.title, a.url)
  const coreB = normalizeCoreTitle(b.title, b.url)
  const compA = compactKey(coreA)
  const compB = compactKey(coreB)
  const infoA = extractHostInfo(a.url)
  const infoB = extractHostInfo(b.url)
  const sameApex = Boolean(infoA.apex && infoA.apex === infoB.apex)

  // A. 规则 3a：同站多语言文档路径完全一致（如 MDN en-US vs zh-CN、Korn Ferry / vs /zh）
  const locA = stripLocalePathKey(a.url)
  const locB = stripLocalePathKey(b.url)
  if (locA && locA === locB && canonicalizeUrlForDedupe(a.url) !== canonicalizeUrlForDedupe(b.url)) {
    return { rule: 'same_subcat_locale_mirror', confidence: 0.99, detail: `多语言路径镜像 (${locA})` }
  }

  // B. 规则 2a：剥离括号与伴生修饰后缀（官方手册/官方架构指南/官方文档/开源仓库/(DAIR)等）后核心名完全一致
  if (compA.length >= 2 && compA === compB && !GENERIC_CORE_BLOCKLIST.has(compA)) {
    const oneIsGit = infoA.isGitHost !== infoB.isGitHost
    const eitherCompanion = hasCompanionSuffix(a.title, a.url) || hasCompanionSuffix(b.title, b.url)
    const exactTitleMatch = a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
    if (exactTitleMatch || sameApex || oneIsGit || eitherCompanion || compA.length >= 4) {
      return {
        rule: 'same_subcat_core_title',
        confidence: exactTitleMatch || sameApex ? 0.98 : 0.94,
        detail: `同子分类核心名一致「${coreA}」`,
      }
    }
  }

  // C. 规则 2b：同子分类词集等价（忽略纯伴生词如 api / docs / official / mdn 位置倒置，如 MDN WebExtensions vs WebExtensions API (MDN)）
  const bareTokA = new Set(tokenizeSimple(a.title).filter((t) => !PURE_COMPANION_TOKENS.has(t) && t.length >= 2))
  const bareTokB = new Set(tokenizeSimple(b.title).filter((t) => !PURE_COMPANION_TOKENS.has(t) && t.length >= 2))
  if (bareTokA.size >= 1 && bareTokA.size === bareTokB.size) {
    const allMatch = [...bareTokA].every((t) => bareTokB.has(t))
    if (allMatch) {
      const joined = [...bareTokA].join(' + ')
      if (!GENERIC_CORE_BLOCKLIST.has(joined)) {
        // 要求同主域、或一方是 Git 仓库、或同词集 >= 2 词（如 {mdn, webextensions}），防单泛词碰撞
        if (sameApex || infoA.isGitHost !== infoB.isGitHost || bareTokA.size >= 2) {
          return {
            rule: 'same_subcat_token_equiv',
            confidence: 0.96,
            detail: `同子分类词集等价「${joined}」`,
          }
        }
      }
    }
  }

  // D. 规则 2c：单侧母公司前缀 + 中英文品牌域名互证（典型案例：可灵 AI [klingai.com] vs 快手可灵 (Kling AI) [klingai.kuaishou.com]）
  const spA = splitVendorPrefix(normalizeCoreTitle(a.title, a.url))
  const spB = splitVendorPrefix(normalizeCoreTitle(b.title, b.url))
  // 严格限定：必须“一方带母公司前缀、另一方不带”，杜绝 百度健康 vs 阿里健康、小米商城 vs 华为商城
  if (Boolean(spA.vendor) !== Boolean(spB.vendor)) {
    const stemA = compactKey(spA.rest.replace(/\bai\b/gi, '').trim())
    const stemB = compactKey(spB.rest.replace(/\bai\b/gi, '').trim())
    if (stemA.length >= 2 && stemA === stemB && !GENERIC_CORE_BLOCKLIST.has(stemA)) {
      const hostTokA = hostBrandTokens(a.url)
      const hostTokB = hostBrandTokens(b.url)
      const sharedHostBrand = [...hostTokA].filter((t) => hostTokB.has(t))
      const bracketsA = extractBracketContents(a.title).map(compactKey)
      const bracketsB = extractBracketContents(b.title).map(compactKey)
      const bracketCorroborated =
        bracketsA.some((bk) => bk.length >= 4 && infoB.host.includes(bk)) ||
        bracketsB.some((bk) => bk.length >= 4 && infoA.host.includes(bk))
      if (sameApex || sharedHostBrand.length > 0 || bracketCorroborated) {
        return {
          rule: 'same_subcat_brand_alias',
          confidence: 0.95,
          detail: `同子分类品牌+域名互证「${stemA}」${sharedHostBrand.length ? ` (domain:${sharedHostBrand[0]})` : ''}`,
        }
      }
    }
  }

  // D2. 规则 2d：同子分类下中文全称 + 英文域名缩写后缀一致（如「中国期货市场监控中心」vs「中国期货市场监控中心 CFMMC」）
  const shorterCore = coreA.length <= coreB.length ? coreA : coreB
  const longerCore = coreA.length <= coreB.length ? coreB : coreA
  if (/[\u4e00-\u9fa5]{3,}/.test(shorterCore) && longerCore.startsWith(shorterCore + ' ')) {
    const suffix = compactKey(longerCore.slice(shorterCore.length).trim())
    if (
      suffix.length >= 3 &&
      /^[a-z0-9]+$/i.test(suffix) &&
      infoA.host.includes(suffix) &&
      infoB.host.includes(suffix)
    ) {
      return {
        rule: 'same_subcat_brand_alias',
        confidence: 0.96,
        detail: `同子分类中文全称+域名缩写重复「${shorterCore}」 (domain:${suffix})`,
      }
    }
  }

  // E. 规则 3b：同子分类下同主机名官网主页 `/` 与官方文档 `/docs` 重复（如 nextjs.org/ vs nextjs.org/docs、bun.sh vs bun.sh/docs、prometheus.io/ vs prometheus.io/docs/...）
  if (infoA.host && infoA.host === infoB.host && !infoA.isGitHost) {
    const aIsRoot = infoA.pathname === '' || infoA.pathname === '/'
    const bIsRoot = infoB.pathname === '' || infoB.pathname === '/'
    const isDocsPath = (p) => /^\/(docs|doc|documentation|guide|manual|handbook|getting-started)(\/|$)/i.test(p)
    const isRootAndDocs = (aIsRoot && isDocsPath(infoB.pathname)) || (bIsRoot && isDocsPath(infoA.pathname))
    if (isRootAndDocs) {
      // 排除特定子概念专题页（如 OpenTelemetry Traces 对应 /docs/concepts/signals/traces/）
      const docsSide = aIsRoot ? b : a
      const rootSide = aIsRoot ? a : b
      const docsDepth = extractHostInfo(docsSide.url).pathname.split('/').filter(Boolean).length
      const docsIsOverview =
        docsDepth <= 2 || /\/(overview|intro|introduction|getting-started|index)$/i.test(extractHostInfo(docsSide.url).pathname)
      const rootComp = compactKey(normalizeCoreTitle(rootSide.title, rootSide.url))
      const docsCore = compactKey(normalizeCoreTitle(docsSide.title, docsSide.url))
      // 词边界校验：避免 `svelte` 误命中 `sveltekit`（如 svelte.dev/ 与 svelte.dev/docs/kit）
      const escapedRoot = rootComp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const docsTitleStartsSameWord = new RegExp(`^${escapedRoot}(?:$|[^a-z0-9])`, 'i').test(
        docsSide.title.trim().replace(/^[\s\-—–·]+/, ''),
      )
      if (docsIsOverview && rootComp.length >= 2 && (docsCore === rootComp || docsTitleStartsSameWord)) {
        return {
          rule: 'same_subcat_root_vs_docs',
          confidence: 0.95,
          detail: `同子分类官网主页与官方文档重复 (${infoA.host})`,
        }
      }
    }
  }

  return null
}

/* ------------------------------------------------------------------ *
 * 3. 并查集（Union-Find）将成对重复聚合为完整重复组
 * ------------------------------------------------------------------ */

class UnionFind {
  constructor() {
    this.parent = new Map()
  }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x)
    let r = x
    while (this.parent.get(r) !== r) r = this.parent.get(r)
    let cur = x
    while (this.parent.get(cur) !== r) {
      const next = this.parent.get(cur)
      this.parent.set(cur, r)
      cur = next
    }
    return r
  }
  union(a, b) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

/* ------------------------------------------------------------------ *
 * 4. 主记录评分策略（保留元数据最完整、热度/收藏权重最高者）
 * ------------------------------------------------------------------ */

export function scoreSiteAsMaster(site) {
  let score = 0
  // 1) 状态与健康度权重最高：绝不保留 broken 淘汰 active
  if (site.status === 'active') score += 1000
  else if (site.status === 'pending') score += 100
  else score -= 500
  if (site.enabled === 1) score += 200
  if (site.health_ok === 1) score += 120
  else if (site.health_ok === 0) score -= 80

  // 2) 真实热度 / 收藏 / 权重
  score += (site.favoriteCount || 0) * 60
  score += (site.collectionCount || 0) * 35
  score += (site.visit_count || 0) * 12
  score += (site.eventCount || 0) * 3
  score += (site.featured ? 90 : 0)
  score += Math.round((site.weight || 0) * 20)
  score += Math.round((site.trend_score || 0) * 5)

  // 3) 元数据完整度
  const descLen = (site.description || '').trim().length
  if (descLen >= 40) score += 45
  else if (descLen >= 15) score += 30
  else if (descLen > 0) score += 10
  if ((site.title_en || '').trim()) score += 12
  if ((site.description_en || '').trim()) score += 12
  if ((site.icon_key || '').trim()) score += 22
  if ((site.screenshot_key || '').trim()) score += 15
  score += Math.min(site.tags.length, 6) * 6
  score += Math.min(site.facetCount || 0, 6) * 3
  if (site.hasRadar) score += 15

  // 4) 官方主站与标准简洁标题优先于 /docs 子页或 GitHub 镜像
  const info = extractHostInfo(site.url)
  if (!info.isGitHost) score += 45
  if (!info.pathname || info.pathname === '/') score += 65
  if (/^\/(docs|doc|documentation)\b/i.test(info.pathname)) score -= 30
  if (/developer\.mozilla\.org\/zh-cn\//i.test(site.url)) score += 25
  if (!hasCompanionSuffix(site.title, site.url)) score += 25

  return score
}

/* ------------------------------------------------------------------ *
 * 5. 主流程：扫描全库 -> 构建合并计划 -> Dry-Run 报告 或 Apply 落库
 * ------------------------------------------------------------------ */

function run() {
  if (!existsSync(dbPath)) {
    console.error(`[dedupe-sites] 数据库文件未找到: ${dbPath}`)
    process.exit(1)
  }

  const storeRequire = createRequire(resolve(rootDir, 'packages/store/package.json'))
  const Database = storeRequire('better-sqlite3')
  const db = new Database(dbPath, { readonly: !isApply })
  if (isApply) {
    db.pragma('journal_mode = WAL')
  }

  const catRows = db.prepare('SELECT id, title, parent_id FROM categories').all()
  const catById = new Map(catRows.map((c) => [c.id, c]))
  const categoryPathLabel = (catId) => {
    const c = catById.get(catId)
    if (!c) return catId || '未分类'
    const p = c.parent_id ? catById.get(c.parent_id) : null
    return p ? `${p.title} / ${c.title}` : c.title
  }

  const rawSites = db
    .prepare(
      `SELECT id, url, title, title_en, description, description_en, icon_key, screenshot_key,
              category_id, sub_category_id, status, enabled, sort, weight, featured, source,
              health_ok, visit_count, last_visited_at, trend_score, created_at, updated_at, metadata
       FROM sites
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
    )
    .all()

  const tagsBySite = new Map()
  for (const row of db
    .prepare('SELECT st.site_id, st.tag_id, t.name FROM site_tags st JOIN tags t ON t.id = st.tag_id')
    .all()) {
    let arr = tagsBySite.get(row.site_id)
    if (!arr) {
      arr = []
      tagsBySite.set(row.site_id, arr)
    }
    arr.push({ tagId: row.tag_id, name: row.name })
  }

  const favCountBySite = new Map(
    db.prepare('SELECT site_id, COUNT(*) AS c FROM favorites WHERE deleted_at IS NULL GROUP BY site_id').all()
      .map((r) => [r.site_id, r.c]),
  )
  const colCountBySite = new Map(
    db.prepare('SELECT site_id, COUNT(*) AS c FROM collection_items GROUP BY site_id').all()
      .map((r) => [r.site_id, r.c]),
  )
  const eventCountBySite = new Map(
    db.prepare('SELECT site_id, COUNT(*) AS c FROM events WHERE site_id IS NOT NULL GROUP BY site_id').all()
      .map((r) => [r.site_id, r.c]),
  )
  const facetCountBySite = new Map(
    db.prepare('SELECT site_id, COUNT(*) AS c FROM site_facets GROUP BY site_id').all()
      .map((r) => [r.site_id, r.c]),
  )
  const radarSiteSet = new Set(
    db.prepare('SELECT site_id FROM site_radar').all().map((r) => r.site_id),
  )

  const sites = rawSites.map((s) => ({
    ...s,
    categoryPath: categoryPathLabel(s.category_id),
    canonicalUrl: canonicalizeUrlForDedupe(s.url),
    tags: tagsBySite.get(s.id) || [],
    favoriteCount: favCountBySite.get(s.id) || 0,
    collectionCount: colCountBySite.get(s.id) || 0,
    eventCount: eventCountBySite.get(s.id) || 0,
    facetCount: facetCountBySite.get(s.id) || 0,
    hasRadar: radarSiteSet.has(s.id),
  }))

  const siteById = new Map(sites.map((s) => [s.id, s]))
  const uf = new UnionFind()
  const edges = []

  // -------- 规则 1：全库规范化 URL 完全相同 --------
  const byCanonUrl = new Map()
  for (const s of sites) {
    if (!s.canonicalUrl) continue
    let list = byCanonUrl.get(s.canonicalUrl)
    if (!list) {
      list = []
      byCanonUrl.set(s.canonicalUrl, list)
    }
    list.push(s)
  }
  for (const [canon, list] of byCanonUrl.entries()) {
    if (list.length < 2) continue
    for (let i = 1; i < list.length; i++) {
      uf.union(list[0].id, list[i].id)
      edges.push({
        a: list[0].id,
        b: list[i].id,
        rule: 'url_exact',
        confidence: 1.0,
        detail: `规范化 URL 完全一致 (${canon})`,
      })
    }
  }

  // -------- 规则 2 & 规则 3：同子分类下名称高度相似 / 包含 / 语言镜像 / 官网+文档重复 --------
  const bySubcat = new Map()
  for (const s of sites) {
    const key = s.category_id || '__uncategorized__'
    let list = bySubcat.get(key)
    if (!list) {
      list = []
      bySubcat.set(key, list)
    }
    list.push(s)
  }

  for (const list of bySubcat.values()) {
    if (list.length < 2) continue
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        if (uf.find(a.id) === uf.find(b.id)) continue
        const match = classifySameSubcatPair(a, b)
        if (match) {
          uf.union(a.id, b.id)
          edges.push({ a: a.id, b: b.id, ...match })
        }
      }
    }
  }

  // -------- 聚合重复簇并决定主/副记录 --------
  const clustersByRoot = new Map()
  for (const e of edges) {
    const root = uf.find(e.a)
    let bucket = clustersByRoot.get(root)
    if (!bucket) {
      bucket = { memberIds: new Set(), reasons: [] }
      clustersByRoot.set(root, bucket)
    }
    bucket.memberIds.add(e.a)
    bucket.memberIds.add(e.b)
    bucket.reasons.push(e)
  }

  const groups = []
  for (const bucket of clustersByRoot.values()) {
    const members = [...bucket.memberIds]
      .map((id) => siteById.get(id))
      .filter(Boolean)
      .map((s) => ({ ...s, masterScore: scoreSiteAsMaster(s) }))
      .sort((x, y) => y.masterScore - x.masterScore || (x.created_at || 0) - (y.created_at || 0) || x.id.localeCompare(y.id))

    if (members.length < 2) continue
    const master = members[0]
    const duplicates = members.slice(1)
    const masterTagIds = new Set(master.tags.map((t) => t.tagId))
    const tagsToMerge = []
    const seenMergeTagIds = new Set()
    for (const dup of duplicates) {
      for (const t of dup.tags) {
        if (!masterTagIds.has(t.tagId) && !seenMergeTagIds.has(t.tagId)) {
          seenMergeTagIds.add(t.tagId)
          tagsToMerge.push(t)
        }
      }
    }

    const primaryRule = bucket.reasons[0]?.rule || 'unknown'
    const uniqueDetails = [...new Set(bucket.reasons.map((r) => r.detail))]
    const crossCategory = new Set(members.map((m) => m.category_id)).size > 1

    groups.push({
      categoryPath: master.categoryPath,
      categoryId: master.category_id,
      crossCategory,
      rule: primaryRule,
      reasons: uniqueDetails,
      master: {
        id: master.id,
        title: master.title,
        url: master.url,
        status: master.status,
        categoryPath: master.categoryPath,
        score: master.masterScore,
        visitCount: master.visit_count || 0,
        favoriteCount: master.favoriteCount,
        tags: master.tags.map((t) => t.name),
      },
      duplicates: duplicates.map((d) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        status: d.status,
        categoryPath: d.categoryPath,
        score: d.masterScore,
        visitCount: d.visit_count || 0,
        favoriteCount: d.favoriteCount,
        tags: d.tags.map((t) => t.name),
      })),
      tagsToMerge,
    })
  }

  groups.sort((a, b) => a.categoryPath.localeCompare(b.categoryPath, 'zh-CN') || a.master.title.localeCompare(b.master.title, 'zh-CN'))

  const totalDuplicateRecords = groups.reduce((acc, g) => acc + g.duplicates.length, 0)
  const byRuleSummary = {}
  for (const g of groups) {
    byRuleSummary[g.rule] = (byRuleSummary[g.rule] || 0) + 1
  }

  const report = {
    mode: isApply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    dbPath,
    scannedSites: sites.length,
    duplicateGroups: groups.length,
    duplicateRecordsToMerge: totalDuplicateRecords,
    remainingSitesAfterDedupe: sites.length - totalDuplicateRecords,
    byRuleSummary,
    groups,
  }

  if (outPath) {
    const absOut = resolve(process.cwd(), outPath)
    mkdirSync(dirname(absOut), { recursive: true })
    writeFileSync(absOut, JSON.stringify(report, null, 2), 'utf8')
  }

  if (!isApply) {
    db.close()
    if (isJsonStdout) {
      console.log(JSON.stringify(report, null, 2))
      return
    }
    printHumanReport(report)
    return
  }

  /* ---------------------------------------------------------------- *
   * 6. --apply 执行安全合并（自动备份 + 单事务 + 旧 ID 别名映射）
   * ---------------------------------------------------------------- */
  if (groups.length === 0) {
    db.close()
    console.log('[dedupe-sites] 未检测到重复站点，无需修改数据库。')
    return
  }

  const backupDir = resolve(rootDir, 'data/backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupFile = resolve(backupDir, `navhub-pre-dedupe-${stamp}.db`)
  copyFileSync(dbPath, backupFile)
  console.log(`[dedupe-sites] 已创建全量回滚备份: ${backupFile}`)

  const now = Date.now()
  db.pragma('foreign_keys = OFF')

  db.exec(`
    CREATE TABLE IF NOT EXISTS site_id_aliases (
      old_site_id TEXT PRIMARY KEY,
      canonical_site_id TEXT NOT NULL,
      old_title TEXT,
      old_url TEXT,
      reason TEXT,
      merged_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_site_id_aliases_canonical ON site_id_aliases(canonical_site_id);
  `)

  const applyTx = db.transaction(() => {
    let mergedCount = 0
    let mergedTagsTotal = 0
    const redirectMap = {}

    try {
      const existingSetting = db.prepare("SELECT value FROM app_settings WHERE key = 'site_id_redirects'").get()
      if (existingSetting?.value) {
        Object.assign(redirectMap, JSON.parse(existingSetting.value))
      }
    } catch { /* ignore */ }

    const rewriteJsonArrayId = (rawJson, oldId, keepId) => {
      if (!rawJson || typeof rawJson !== 'string') return null
      try {
        const arr = JSON.parse(rawJson)
        if (!Array.isArray(arr) || !arr.includes(oldId)) return null
        const next = []
        for (const item of arr) {
          const mapped = item === oldId ? keepId : item
          if (!next.includes(mapped)) next.push(mapped)
        }
        return JSON.stringify(next)
      } catch {
        return null
      }
    }

    for (const group of groups) {
      const keepId = group.master.id
      const keepRow = db.prepare('SELECT * FROM sites WHERE id = ?').get(keepId)
      if (!keepRow) continue

      let addVisits = 0
      let maxWeight = keepRow.weight || 0
      let maxTrend = keepRow.trend_score || 0
      let maxFeatured = keepRow.featured || 0
      let maxLastVisited = keepRow.last_visited_at || null
      let bestDesc = keepRow.description || ''
      let bestTitleEn = keepRow.title_en || null
      let bestDescEn = keepRow.description_en || null
      let bestIcon = keepRow.icon_key || null
      let bestShot = keepRow.screenshot_key || null

      for (const dupMeta of group.duplicates) {
        const dupId = dupMeta.id
        if (dupId === keepId) continue
        const dupRow = db.prepare('SELECT * FROM sites WHERE id = ?').get(dupId)
        if (!dupRow) continue

        addVisits += dupRow.visit_count || 0
        if ((dupRow.weight || 0) > maxWeight) maxWeight = dupRow.weight
        if ((dupRow.trend_score || 0) > maxTrend) maxTrend = dupRow.trend_score
        if ((dupRow.featured || 0) > maxFeatured) maxFeatured = dupRow.featured
        if (dupRow.last_visited_at && (!maxLastVisited || dupRow.last_visited_at > maxLastVisited)) {
          maxLastVisited = dupRow.last_visited_at
        }
        if ((dupRow.description || '').trim().length > bestDesc.trim().length + 12) {
          bestDesc = dupRow.description.trim()
        }
        if (!bestTitleEn && dupRow.title_en) bestTitleEn = dupRow.title_en
        if (!bestDescEn && dupRow.description_en) bestDescEn = dupRow.description_en
        if (!bestIcon && dupRow.icon_key) bestIcon = dupRow.icon_key
        if (!bestShot && dupRow.screenshot_key) bestShot = dupRow.screenshot_key

        // 1) 合并差异有效标签
        const dupTags = db.prepare('SELECT tag_id FROM site_tags WHERE site_id = ?').all(dupId)
        for (const t of dupTags) {
          const info = db.prepare('INSERT OR IGNORE INTO site_tags (site_id, tag_id) VALUES (?, ?)').run(keepId, t.tag_id)
          if (info.changes > 0) mergedTagsTotal++
        }
        db.prepare('DELETE FROM site_tags WHERE site_id = ?').run(dupId)

        // 2) 合并立面
        const dupFacets = db.prepare('SELECT facet_key, facet_value FROM site_facets WHERE site_id = ?').all(dupId)
        for (const f of dupFacets) {
          db.prepare('INSERT OR IGNORE INTO site_facets (site_id, facet_key, facet_value) VALUES (?, ?, ?)').run(
            keepId,
            f.facet_key,
            f.facet_value,
          )
        }
        db.prepare('DELETE FROM site_facets WHERE site_id = ?').run(dupId)

        // 3) 迁移收藏（避免同用户重复收藏冲突）
        const dupFavs = db.prepare('SELECT id, user_id FROM favorites WHERE site_id = ?').all(dupId)
        for (const fav of dupFavs) {
          const existsKeep = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND site_id = ? AND deleted_at IS NULL').get(fav.user_id, keepId)
          if (existsKeep) {
            db.prepare('DELETE FROM favorites WHERE id = ?').run(fav.id)
          } else {
            db.prepare('UPDATE favorites SET site_id = ?, updated_at = ? WHERE id = ?').run(keepId, now, fav.id)
          }
        }

        // 4) 迁移合集条目
        const dupCols = db.prepare('SELECT collection_id FROM collection_items WHERE site_id = ?').all(dupId)
        for (const col of dupCols) {
          const existsKeep = db.prepare('SELECT 1 FROM collection_items WHERE collection_id = ? AND site_id = ?').get(col.collection_id, keepId)
          if (existsKeep) {
            db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND site_id = ?').run(col.collection_id, dupId)
          } else {
            db.prepare('UPDATE collection_items SET site_id = ? WHERE collection_id = ? AND site_id = ?').run(keepId, col.collection_id, dupId)
          }
        }

        // 5) 迁移其余引用表
        db.prepare('UPDATE events SET site_id = ? WHERE site_id = ?').run(keepId, dupId)
        db.prepare('UPDATE health_checks SET site_id = ? WHERE site_id = ?').run(keepId, dupId)
        db.prepare('UPDATE category_remaps SET site_id = ? WHERE site_id = ?').run(keepId, dupId)
        db.prepare('UPDATE OR IGNORE submission_owners SET site_id = ? WHERE site_id = ?').run(keepId, dupId)
        db.prepare('DELETE FROM submission_owners WHERE site_id = ?').run(dupId)
        db.prepare('UPDATE watch_entries SET platform_site_id = ? WHERE platform_site_id = ?').run(keepId, dupId)
        db.prepare('UPDATE wanted_searches SET notified_site_id = ? WHERE notified_site_id = ?').run(keepId, dupId)
        db.prepare('UPDATE site_archives SET site_id = ? WHERE site_id = ?').run(keepId, dupId)
        db.prepare('UPDATE OR IGNORE site_prices SET site_id = ? WHERE site_id = ?').run(keepId, dupId)
        db.prepare('DELETE FROM site_prices WHERE site_id = ?').run(dupId)

        const keepRadar = db.prepare('SELECT 1 FROM site_radar WHERE site_id = ?').get(keepId)
        if (keepRadar) {
          db.prepare('DELETE FROM site_radar WHERE site_id = ?').run(dupId)
        } else {
          db.prepare('UPDATE site_radar SET site_id = ? WHERE site_id = ?').run(keepId, dupId)
        }

        // 6) 迁移站点关系
        db.prepare('DELETE FROM site_relations WHERE (source_site_id = ? AND target_site_id = ?) OR (source_site_id = ? AND target_site_id = ?)').run(
          dupId, keepId, keepId, dupId,
        )
        db.prepare('UPDATE OR IGNORE site_relations SET source_site_id = ? WHERE source_site_id = ?').run(keepId, dupId)
        db.prepare('UPDATE OR IGNORE site_relations SET target_site_id = ? WHERE target_site_id = ?').run(keepId, dupId)
        db.prepare('DELETE FROM site_relations WHERE source_site_id = ? OR target_site_id = ?').run(dupId, dupId)

        // 7) 更新 user_profiles / comparison_snapshots JSON 数组里的旧 siteId
        const profiles = db.prepare('SELECT user_id, visited_site_ids, favorite_site_ids FROM user_profiles WHERE visited_site_ids LIKE ? OR favorite_site_ids LIKE ?').all(
          `%${dupId}%`,
          `%${dupId}%`,
        )
        for (const p of profiles) {
          const nextVisited = rewriteJsonArrayId(p.visited_site_ids, dupId, keepId)
          const nextFav = rewriteJsonArrayId(p.favorite_site_ids, dupId, keepId)
          if (nextVisited !== null || nextFav !== null) {
            db.prepare('UPDATE user_profiles SET visited_site_ids = COALESCE(?, visited_site_ids), favorite_site_ids = COALESCE(?, favorite_site_ids) WHERE user_id = ?').run(
              nextVisited,
              nextFav,
              p.user_id,
            )
          }
        }
        const snapshots = db.prepare('SELECT id, site_ids FROM comparison_snapshots WHERE site_ids LIKE ?').all(`%${dupId}%`)
        for (const snap of snapshots) {
          const nextIds = rewriteJsonArrayId(snap.site_ids, dupId, keepId)
          if (nextIds !== null) {
            db.prepare('UPDATE comparison_snapshots SET site_ids = ? WHERE id = ?').run(nextIds, snap.id)
          }
        }

        // 8) 清理副记录向量
        db.prepare('DELETE FROM embeddings WHERE site_id = ?').run(dupId)

        // 9) 写入旧 siteId 重定向 / 别名映射（含链式传递收敛）
        db.prepare(
          `INSERT INTO site_id_aliases (old_site_id, canonical_site_id, old_title, old_url, reason, merged_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(old_site_id) DO UPDATE SET canonical_site_id = excluded.canonical_site_id, merged_at = excluded.merged_at`,
        ).run(dupId, keepId, dupRow.title, dupRow.url, group.reasons.join('; '), now)
        db.prepare('UPDATE site_id_aliases SET canonical_site_id = ? WHERE canonical_site_id = ?').run(keepId, dupId)
        redirectMap[dupId] = keepId
        for (const [k, v] of Object.entries(redirectMap)) {
          if (v === dupId) redirectMap[k] = keepId
        }

        // 10) 删除副记录（同步触发 sites_fts_ad / sites_substr_ad / data_version 自增）
        db.prepare('DELETE FROM sites WHERE id = ?').run(dupId)
        mergedCount++
      }

      db.prepare(
        `UPDATE sites
         SET visit_count = visit_count + ?,
             weight = ?,
             trend_score = ?,
             featured = ?,
             last_visited_at = ?,
             description = ?,
             title_en = ?,
             description_en = ?,
             icon_key = ?,
             screenshot_key = ?,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        addVisits,
        maxWeight,
        maxTrend,
        maxFeatured,
        maxLastVisited,
        bestDesc,
        bestTitleEn,
        bestDescEn,
        bestIcon,
        bestShot,
        now,
        keepId,
      )
    }

    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('site_id_redirects', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(redirectMap), now)

    return { mergedCount, mergedTagsTotal, totalRedirects: Object.keys(redirectMap).length }
  })

  const result = applyTx()
  db.pragma('foreign_keys = ON')
  db.close()

  console.log('\n==========================================')
  console.log('[dedupe-sites] 安全合并落库完成！')
  console.log(`- 合并重复组: ${groups.length} 组`)
  console.log(`- 清理副记录: ${result.mergedCount} 条`)
  console.log(`- 合并差异标签: ${result.mergedTagsTotal} 个`)
  console.log(`- 累计旧 siteId 重定向映射: ${result.totalRedirects} 条 (site_id_aliases + app_settings)`)
  console.log(`- 备份文件: ${backupFile}`)
  console.log('==========================================\n')
}

function printHumanReport(report) {
  console.log('====================================================================')
  console.log(`[dedupe-sites] DRY-RUN 重复站点巡检报告（零数据库写入）`)
  console.log(`- 扫描库: ${report.dbPath}`)
  console.log(`- 扫描活跃站点: ${report.scannedSites} 条`)
  console.log(`- 命中重复组: ${report.duplicateGroups} 组（拟合并清理 ${report.duplicateRecordsToMerge} 条副记录，合并后剩余 ${report.remainingSitesAfterDedupe} 条）`)
  console.log(`- 规则分布: ${JSON.stringify(report.byRuleSummary)}`)
  console.log('====================================================================\n')

  report.groups.forEach((g, idx) => {
    const tag = g.crossCategory ? `${g.categoryPath} [跨分类]` : g.categoryPath
    console.log(`${String(idx + 1).padStart(2, '0')}. [${g.rule}] ${tag}`)
    console.log(`    命中原因: ${g.reasons.join(' | ')}`)
    console.log(`    ✅ 保留主记录: 「${g.master.title}」 (${g.master.url}) [id=${g.master.id}, status=${g.master.status}, score=${g.master.score}]`)
    for (const d of g.duplicates) {
      const catNote = d.categoryPath !== g.master.categoryPath ? `, cat=${d.categoryPath}` : ''
      console.log(`    ❌ 合并副记录: 「${d.title}」 (${d.url}) [id=${d.id}, status=${d.status}, score=${d.score}${catNote}]`)
    }
    if (g.tagsToMerge.length > 0) {
      console.log(`    🏷️  迁入差异标签: ${g.tagsToMerge.map((t) => `#${t.name}`).join(', ')}`)
    }
    console.log('')
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run()
}
