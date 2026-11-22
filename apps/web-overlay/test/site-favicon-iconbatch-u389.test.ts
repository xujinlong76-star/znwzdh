import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCAL_LOGO_MAP, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 U-389（2026-11-21；审计原编号 U-384，雷达 109 轮订正为 U-389，
 * 审计的 U-362 是工作区持久化，不要混淆）。分层修法（进化轮 17:22 线 E
 * 笔记，按 P1/P2/P3 三档做）：
 *
 * 口径：39 条 /assets/images/logos/* 引用在 overlay 公共目录中全部不
 * 存在，但运行时实际服务的树是 apps/web 不是 overlay，39 个目标文件名
 * 在 served 树与上游钉死 tarball 里全部存在，因此「运行时 404」的说法
 * 不成立。本项性质是「依赖未跟踪的上游资产 + 仓库内无落盘」，属资产
 * 归属/稳健性问题，不按线上故障定级。「fresh worktree 下无 404」不再
 * 是验收标准。
 *
 * P1——7 条标题规则（chatgpt/claude/cloudflare/figma/tinypng/unsplash/
 * vercel）：迁移目标全部已跟踪，直接改路径。7 条当前对已跟踪目录不可
 * 达（被 map 遮蔽），属潜伏问题，与已修的 gemini 同类收尾。
 * P2——2 条 map 条目（均当前死键，低风险）：:228 v0.dev →
 * /brand-icons/vercel.png；:249 anthropic.com → /brand-icons/claude.svg。
 * P3——补 30 个品牌图标：先做图标落盘轮——以 served 树
 * apps/web/public/assets/images/logos/ 里的同名文件为候选源（30/30 在
 * 盘），逐个验证内容/尺寸/品牌一致性后复制进 public/brand-icons/，再
 * 改 map 值；不许只改路径。唯一 live 的 colorhunt.co 排本批最前，其余
 * 31 条当前死键可后置（本批一并落盘+改值，不留尾巴）。
 * P3 落盘验证（2026-11-21 实测，30/30）：文件均在 served 树在盘；均
 * 为有效图片（29 WebP：44×44 ×24、32×32 ×4、16×16 ×1；poe.svg
 * viewBox 256×256）；复制后 md5 与 served 树字节逐个一致；文件名↔
 * hostname 配对沿用基底代码已有的上游配对（只改目录前缀，不改配对）。
 * cloudflar.webp 拼写不是 bug：vendor 磁盘即此名；brand-icons 侧用
 * 正确的 cloudflare.png（与 a1b 批 cloudflare.com → cloudflare.png
 * 一致），迁后拼写问题消失。
 *
 * 未决 caveat（写进回报，不下结论）：运行时目录真实数据源是 API 数据
 * 库（data/navhub.db），本轮只核对了已跟踪的 navigation.json 默认模板
 * （388 站 + navigation-default.json 55 站 + seed-data.json 143 站，
 * 414 个 distinct hostname；其中仅 colorhunt.co 命中 32 条 map 键）；
 * 数据库中是否另有命中 31 个死键 hostname 或 :1356–:1362 标题的条目
 * 未核查（本 worktree 无 data/navhub.db，只有 data/e2e 测试库）；
 * 电脑 :3000 实况树的 vendor 文件是否在盘无法核实（未碰电脑实况树）。
 *
 * 本文件是改法 B 的门禁：源码里出现的本地图标路径必须在 served 树存在，
 * 且 live map 里不许再有 /assets/images/logos/* 引用——下次再有人加一
 * 个不存在的目录，CI 当场抓住。
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY = resolve(HERE, '..')
const PUBLIC = join(OVERLAY, 'public')

function repoRoot(): string {
  let dir = OVERLAY
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    dir = dirname(dir)
  }
  throw new Error('找不到仓库根目录（应有 pnpm-workspace.yaml）')
}

const REPO = repoRoot()

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/** 源码字面量里的本地图标路径（只认 /brand-icons/ 与 /assets/ 两类前缀）。 */
function localIconPaths(source: string): string[] {
  const stripped = stripComments(source)
  return [...stripped.matchAll(/["'](\/(?:brand-icons|assets)\/[^"'\s]+)["']/g)].map((m) => m[1]!)
}

/** JSON 里所有以 '/' 开头的字符串值（icon 字段等）。 */
function localIconValues(data: unknown, out: string[] = []): string[] {
  if (typeof data === 'string') {
    if (data.startsWith('/')) out.push(data)
  } else if (Array.isArray(data)) {
    for (const v of data) localIconValues(v, out)
  } else if (data && typeof data === 'object') {
    for (const v of Object.values(data)) localIconValues(v, out)
  }
  return out
}

const TITLE_CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://example.com/chatgpt', title: 'ChatGPT 官网', expected: '/brand-icons/chatgpt.svg' },
  { url: 'https://example.com/claude', title: 'Claude 对话', expected: '/brand-icons/claude.svg' },
  { url: 'https://example.com/cloudflare', title: 'Cloudflare Pages', expected: '/brand-icons/cloudflare.png' },
  { url: 'https://example.com/figma', title: 'Figma 设计', expected: '/brand-icons/figma.svg' },
  { url: 'https://example.com/tinypng', title: 'TinyPNG 压缩', expected: '/brand-icons/tinypng.png' },
  { url: 'https://example.com/unsplash', title: 'Unsplash 图库', expected: '/brand-icons/unsplash.png' },
  { url: 'https://example.com/vercel', title: 'Vercel 部署', expected: '/brand-icons/vercel.png' },
]

// overlay map 32 条（P1 标题规则外的全部）：P2 两条（v0.dev、anthropic.com）
// 与 P3 其余 30 条（含唯一 live 的 colorhunt.co）一并断言。
const DOMAIN_CASES: Array<{ url: string; title: string; expected: string }> = [
  { url: 'https://v0.dev', title: 'v0', expected: '/brand-icons/vercel.png' },
  { url: 'https://anthropic.com', title: 'Anthropic', expected: '/brand-icons/claude.svg' },
  { url: 'https://material.io', title: 'Material Design', expected: '/brand-icons/Materialicons.webp' },
  { url: 'https://colorhunt.co', title: 'Color Hunt', expected: '/brand-icons/colorhunt.webp' },
  { url: 'https://flinto.com', title: 'Flinto', expected: '/brand-icons/flinto.webp' },
  { url: 'https://framer.com', title: 'Framer', expected: '/brand-icons/framer.webp' },
  { url: 'https://freepik.com', title: 'Freepik', expected: '/brand-icons/freepik.webp' },
  { url: 'https://iconarchive.com', title: 'Icon Archive', expected: '/brand-icons/iconarchive.webp' },
  { url: 'https://iconfinder.com', title: 'Iconfinder', expected: '/brand-icons/Iconfinder.webp' },
  { url: 'https://iconmonstr.com', title: 'iconmonstr', expected: '/brand-icons/iconmonstr.webp' },
  { url: 'https://ionicons.com', title: 'Ionicons', expected: '/brand-icons/ionicons.webp' },
  { url: 'https://poe.com', title: 'Poe', expected: '/brand-icons/poe.svg' },
  { url: 'https://producthunt.com', title: 'Product Hunt', expected: '/brand-icons/producthunt.webp' },
  { url: 'https://tensor.art', title: 'Tensor Art', expected: '/brand-icons/tensorart.webp' },
  { url: 'https://icomoon.io', title: 'IcoMoon', expected: '/brand-icons/IcoMoonApp.webp' },
  { url: 'https://findicons.com', title: 'FindIcons', expected: '/brand-icons/FindIcons.webp' },
  { url: 'https://principleformac.com', title: 'Principle', expected: '/brand-icons/principle.webp' },
  { url: 'https://worldvectorlogo.com', title: 'World Vector Logo', expected: '/brand-icons/worldvectorlogo.webp' },
  { url: 'https://shots.so', title: 'Shots', expected: '/brand-icons/shots.webp' },
  { url: 'https://simplelineicons.com', title: 'Simple Line Icons', expected: '/brand-icons/simplelineicons.webp' },
  { url: 'https://sqlformat.org', title: 'SQL Format', expected: '/brand-icons/sqlformat.webp' },
  { url: 'https://tableconvert.com', title: 'TableConvert', expected: '/brand-icons/tableconvert.webp' },
  { url: 'https://json.cn', title: 'JSON', expected: '/brand-icons/json.webp' },
  { url: 'https://beautifier.io', title: 'Beautifier', expected: '/brand-icons/beautifier.webp' },
  { url: 'https://ui-cloud.com', title: 'UI Cloud', expected: '/brand-icons/UICloud.webp' },
  { url: 'https://ads.google.com', title: 'Google Ads', expected: '/brand-icons/gads.webp' },
  { url: 'https://analytics.google.com', title: 'Google Analytics', expected: '/brand-icons/analytics.webp' },
  { url: 'https://photoshop.com', title: 'Photoshop', expected: '/brand-icons/photoshop.webp' },
  { url: 'https://affinity.serif.com', title: 'Affinity Designer', expected: '/brand-icons/AffinityDesigner.webp' },
  { url: 'https://instantlogosearch.com', title: 'Instant Logo Search', expected: '/brand-icons/InstantLogoSearch.webp' },
  { url: 'https://iconsfeed.com', title: 'IconsFeed', expected: '/brand-icons/iconsfeed.webp' },
  { url: 'https://iosicongallery.com', title: 'iOS Icon Gallery', expected: '/brand-icons/iosicongallery.webp' },
]

describe('resolveSiteIcon（图标修复 U-389 分层修法 P1/P2/P3）', () => {
  it.each(TITLE_CASES)('P1 标题规则 $title 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it.each(DOMAIN_CASES)('P2/P3 域名映射 $url 解析到 $expected', ({ url, title, expected }) => {
    expect(resolveSiteIcon(url, title)).toBe(expected)
  })

  it('P1：7 个标题规则的目标文件在 brand-icons/ 真实存在', () => {
    for (const { expected } of TITLE_CASES) {
      expect(existsSync(join(PUBLIC, expected.slice(1))), expected).toBe(true)
    }
  })

  it('P2/P3：32 个域名映射的目标文件在 brand-icons/ 真实存在', () => {
    for (const { expected } of DOMAIN_CASES) {
      expect(existsSync(join(PUBLIC, expected.slice(1))), expected).toBe(true)
    }
  })
})

describe('U-389 门禁：本地图标引用必须在 served 树存在，live map 无 /assets 引用', () => {
  const SOURCES = [
    join(OVERLAY, 'src/components/site-favicon.tsx'),
    join(REPO, 'packages/core/src/deterministic-favicon.ts'),
    join(OVERLAY, 'src/navsphere/content/navigation-default.json'),
    join(REPO, 'apps/api/src/seed-data.json'),
  ]

  it('先确认扫描覆盖面（4 个引用源文件均可读）', () => {
    for (const f of SOURCES) expect(existsSync(f), f).toBe(true)
  })

  it('4 个引用源里不再有指向 /assets/images/logos/ 的 live 引用', () => {
    for (const f of SOURCES) {
      const raw = readFileSync(f, 'utf8')
      const live = f.endsWith('.json') ? raw : stripComments(raw)
      expect(live, f).not.toContain('/assets/images/logos/')
    }
  })

  it('源码字面量里的每个本地图标路径都在 public/ 落盘', () => {
    const missing: string[] = []
    let total = 0
    for (const f of SOURCES.filter((x) => !x.endsWith('.json'))) {
      for (const p of localIconPaths(readFileSync(f, 'utf8'))) {
        total++
        if (!existsSync(join(PUBLIC, p.slice(1)))) missing.push(`${f} :: ${p}`)
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it('两份 JSON 数据里每个本地 icon 值都在 public/ 落盘', () => {
    const missing: string[] = []
    let total = 0
    for (const f of SOURCES.filter((x) => x.endsWith('.json'))) {
      for (const p of localIconValues(JSON.parse(readFileSync(f, 'utf8')))) {
        total++
        if (!existsSync(join(PUBLIC, p.slice(1)))) missing.push(`${f} :: ${p}`)
      }
    }
    expect(total).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it('overlay 侧 LOCAL_LOGO_MAP 展开后的每个本地值都在 public/ 落盘', () => {
    const missing: string[] = []
    const locals = Object.values(LOCAL_LOGO_MAP).filter((v) => v.startsWith('/'))
    expect(locals.length).toBeGreaterThan(300)
    for (const v of locals) {
      expect(v.startsWith('/brand-icons/'), v).toBe(true)
      if (!existsSync(join(PUBLIC, v.slice(1)))) missing.push(v)
    }
    expect(missing).toEqual([])
  })

  it('core 侧 41 条 map 键全在且值均为 /brand-icons/（P3 同步 core）', () => {
    const core = stripComments(readFileSync(join(REPO, 'packages/core/src/deterministic-favicon.ts'), 'utf8'))
    const keys = [
      'chatgpt.com', 'chat.openai.com', 'openai.com', 'claude.ai', 'anthropic.com',
      'cloudflare.com', 'figma.com', 'tinypng.com', 'unsplash.com', 'vercel.com',
      'fonts.google.com', 'material.io', 'colorhunt.co', 'flinto.com', 'flaticon.com',
      'fontawesome.com', 'framer.com', 'freepik.com', 'gemini.google.com',
      'iconarchive.com', 'iconfinder.com', 'iconfont.cn', 'iconmonstr.com',
      'ionicons.com', 'leonardo.ai', 'poe.com', 'producthunt.com', 'tensor.art',
      'icomoon.io', 'findicons.com', 'principleformac.com', 'worldvectorlogo.com',
      'shots.so', 'simplelineicons.com', 'sqlformat.org', 'tableconvert.com',
      'json.cn', 'beautifier.io', 'ui-cloud.com', 'ads.google.com', 'analytics.google.com',
    ]
    expect(keys).toHaveLength(41)
    for (const k of keys) {
      const m = core.match(new RegExp(`'${k.replace('.', '\\.')}': '([^']+)'`))
      expect(m, k).not.toBeNull()
      expect(m![1]!.startsWith('/brand-icons/'), k).toBe(true)
    }
  })
})
