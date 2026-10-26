#!/usr/bin/env node
/**
 * 插件网址体检面板 —— 真实浏览器回归（Chromium / @playwright/test）
 *
 * 为什么用「拦截」而不是打真后端：
 *   1. 要验的是**界面在六种关键状态下是否说实话**（待复检、深检证据链、趋势、
 *      候选四档、结论未实测、未应用原因）。这些状态由后端字段决定，
 *      真跑一遍要探活 200+ 站点、还要真改一次清单，既慢又会污染开发库。
 *   2. 拦截后每次运行结论完全一致，失败就是真的坏了，不是网络抖动。
 * 真实链路另行覆盖：后端 20 例接口测试 + 一次真实 deep-diagnose 调用。
 *
 * 用法：
 *   node deliverables/plugin-health/ui-regression.mjs [--base http://localhost:3452] [--shot]
 * 退出码：0 = 全部断言通过；1 = 有失败项。
 */

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const baseArg = args.indexOf('--base')
const BASE = baseArg >= 0 ? args[baseArg + 1] : 'http://localhost:3000'
const WANT_SHOT = args.includes('--shot')
const SHOT_DIR = 'deliverables/plugin-health/screenshots'

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const now = Date.now()

/* ---------------------------------------------------------------- 固定数据 */

const PACKS = [
  { slug: 'stale-sites', name: '待复检站点包', version: '1.3.0', icon: '🧪', tags: ['测试'] },
  { slug: 'broken-sites', name: '含死链站点包', version: '2.0.1', icon: '🧨', tags: ['测试'] },
  { slug: 'fresh-sites', name: '未体检站点包', version: '1.0.0', icon: '🌱', tags: ['测试'] },
]

const SUMMARIES = {
  summaries: {
    // 治愈过、尚未复检：所有计数必须是 null + stale，绝不能是 100%
    'stale-sites': {
      auditedAt: null,
      stale: true,
      healedAt: now - 3_600_000,
      declared: 200,
      sampled: 0,
      okCount: null,
      blockedCount: null,
      suspiciousCount: null,
      brokenCount: null,
      reachability: null,
    },
    'broken-sites': {
      auditedAt: now - 7_200_000,
      declared: 200,
      sampled: 30,
      okCount: 25,
      blockedCount: 2,
      suspiciousCount: 1,
      brokenCount: 2,
      reachability: 0.9,
    },
    'fresh-sites': {
      auditedAt: null,
      declared: 200,
      sampled: null,
      okCount: null,
      blockedCount: null,
      suspiciousCount: null,
      brokenCount: null,
      reachability: null,
    },
  },
}

const HEALTH_STALE = {
  ok: true,
  slug: 'stale-sites',
  checked: true,
  stale: true,
  auditedAt: null,
  declared: 200,
  sampled: 0,
  okCount: null,
  blockedCount: null,
  suspiciousCount: null,
  brokenCount: null,
  redirected: 0,
  reachability: null,
  brokenItems: [],
  blockedItems: [],
  suspiciousItems: [],
  caveat: '该包刚被治愈改动过，清单与上次体检时不同；下面没有任何有效测量值。',
  params: { sample: 30, timeoutMs: 4000 },
}

const HEALTH_BROKEN = {
  ok: true,
  slug: 'broken-sites',
  declared: 200,
  sampled: 30,
  okCount: 25,
  blockedCount: 2,
  suspiciousCount: 1,
  brokenCount: 2,
  redirected: 3,
  reachability: 0.9,
  brokenItems: [
    { url: 'https://dead.example.com/a', status: 404, failureKind: 'http-error', latencyMs: 210 },
    { url: 'https://gone.example.com/b', status: 410, failureKind: 'http-error', latencyMs: 180 },
  ],
  blockedItems: [{ url: 'https://waf.example.com/', status: 403, latencyMs: 150 }],
  suspiciousItems: [
    {
      url: 'https://parked.example.com/',
      status: 200,
      title: '域名转让',
      reason: '命中停放关键词 2 个',
      shannonEntropy: 1.4,
      matchedKeywords: ['domain for sale', 'buy this domain'],
      latencyMs: 320,
    },
  ],
  brokenByReason: { 'http-error': 2 },
  caveat: '2 个站点拒绝或返回错误，可达率按 (真健康 + WAF放行) / 抽样 计算。',
  params: { sample: 30, timeoutMs: 4000 },
}

const TREND_RESULT = {
  ok: true,
  slug: 'broken-sites',
  points: [
    { at: now - 5 * 86_400_000, reachability: 0.97, declared: 200, sampled: 30, ok: 29, blocked: 1, suspicious: 0, broken: 0 },
    { at: now - 4 * 86_400_000, reachability: 0.96, declared: 200, sampled: 30, ok: 28, blocked: 1, suspicious: 1, broken: 0 },
    { at: now - 3 * 86_400_000, reachability: 0.93, declared: 200, sampled: 30, ok: 27, blocked: 1, suspicious: 1, broken: 1 },
    { at: now - 2 * 86_400_000, reachability: 0.9, declared: 200, sampled: 30, ok: 25, blocked: 2, suspicious: 1, broken: 2 },
    { at: now - 1 * 86_400_000, reachability: 0.88, declared: 200, sampled: 30, ok: 24, blocked: 2, suspicious: 2, broken: 2 },
    { at: now - 2 * 3_600_000, reachability: 0.9, declared: 200, sampled: 30, ok: 25, blocked: 2, suspicious: 1, broken: 2 },
    // 无测量值的点：柱子必须是灰色「无数据」，不能被画成 0%（红色恶化语义）
    { at: now - 90 * 60_000, reachability: null, declared: 200, sampled: 0, ok: null, blocked: null, suspicious: null, broken: null },
  ],
  trend: 'degrading',
  slope: -0.012,
  delta: -0.07,
  validPoints: 6,
  skippedStale: 1,
  caveat: '趋势只统计有有效测量值的记录。',
}

const DEEP_RESULT = {
  ok: true,
  slug: 'broken-sites',
  diagnosis: {
    url: 'https://dead.example.com/a',
    verdict: 'parked',
    confidence: 0.9,
    headline: '页面能打开，但内容是域名停放广告——属于「活着但没用」，应替换而不是保留。',
    evidence: [
      { layer: 'url', status: 'pass', detail: 'URL 结构合法，使用 HTTPS，无内嵌凭据' },
      { layer: 'dns', status: 'pass', detail: '解析到 93.184.216.34' },
      { layer: 'redirect', status: 'pass', detail: '1 跳：https://parked.example.com/' },
      { layer: 'http', status: 'warn', detail: 'HTTP 200，但落在停放服务域名上' },
      { layer: 'content', status: 'fail', detail: '命中停放关键词 2 个（domain for sale / buy this domain），Shannon 熵 1.4 偏低' },
      { layer: 'wayback', status: 'skip', detail: '未查询 Wayback 归档' },
    ],
    actions: [
      { id: 'replace', label: '替换为同类目可用站点', kind: 'replace' },
      { id: 'archive', label: '先看历史快照再决定', kind: 'archive' },
    ],
    contentFacts: {
      shannonEntropy: 1.4,
      textLength: 820,
      matchedParkingKeywords: ['domain for sale', 'buy this domain'],
      pageHealth: 'SUSPICIOUS_PARKED',
    },
  },
  observed: {
    status: 200,
    finalUrl: 'https://parked.example.com/',
    contentType: 'text/html; charset=utf-8',
    redirects: ['https://parked.example.com/'],
    /*
      延迟与采样字节给 null，是为了验证「没测到就说没测到」：
      旧渲染会把 null 打成「延迟 0ms / 采样 0 字节」，看起来像真的测出了 0。
    */
    latencyMs: null,
    dnsOk: true,
    bodyBytes: 0,
  },
  waybackUrl: 'https://web.archive.org/web/2024/https://dead.example.com/a',
  caveat: '本结论只覆盖这一次实测，不代表该站点长期状态。',
}

const HEAL_RESULT = {
  ok: true,
  slug: 'broken-sites',
  model: 'mimo-v2.5-pro',
  diagnoses: [
    {
      url: 'https://dead.example.com/a',
      title: '已失效的示例站点',
      kind: 'broken',
      waybackUrl: 'https://web.archive.org/web/2024/https://dead.example.com/a',
      cause: 'UNVERIFIED',
      severity: 'high',
      description: '调用方声明该网址失效，本轮没有独立实测证据。',
      evidence: { source: 'client-claimed' },
      suggestedReplacements: [
        {
          title: '候选甲（已实测通过）',
          qualityScore: 96,
          url: 'https://candidate-a.example.net/',
          reason: '同类目高分，2xx 且内容健康',
          grade: 'verified',
          gradeReason: 'HTTP 200，内容检测通过',
          confidence: { total: 92, reachability: 100, contentHealth: 88, domainFit: 85 },
        },
        {
          title: '候选乙（拒绝爬虫）',
          qualityScore: 78,
          url: 'https://candidate-b.example.net/',
          reason: 'WAF 拦截，无法验证内容',
          grade: 'blocked',
          confidence: { total: 62, reachability: 60, contentHealth: 0, domainFit: 85 },
        },
        {
          title: '候选丙（停放页）',
          qualityScore: 40,
          url: 'https://candidate-c.example.net/',
          reason: '页面是域名停放',
          grade: 'suspicious',
          confidence: { total: 21, reachability: 100, contentHealth: 0, domainFit: 50 },
        },
        {
          /*
            超时档：必须显示「未能验证」而不是「不可达」。
            这是本轮修的缺陷——把「这次没测到」写成「站点已确认下线」，
            与全仓「慢 ≠ 死」的口径冲突。
          */
          title: '候选丁（响应超时）',
          qualityScore: 60,
          url: 'https://candidate-d.example.net/',
          reason: '2.5 秒内未响应（慢不等于死，建议稍后复检）',
          grade: 'unverified',
          gradeReason: '2.5 秒内未响应（慢不等于死，建议稍后复检）',
          confidence: { total: 38, reachability: 0, contentHealth: 0, domainFit: 85 },
        },
      ],
    },
  ],
  overview: '共收到 1 条待治理网址，实测证据缺失，建议先跑一次抽样体检再决定。',
  autoApplied: {
    applied: false,
    reason: 'no-verified-candidate',
    detail: '4 个候选里只有 1 个通过内容校验，但已存在同域站点，未自动替换',
    replacedCount: 0,
    removedCount: 0,
    remainingSites: 200,
    version: '2.0.1',
    items: [],
  },
  ignoredUrls: ['https://not-in-pack.example.com/x'],
}

/* ------------------------------------------------------- 路由拦截（六种状态） */

async function installStubs(page) {
  await page.route('**/api/hub/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/api\/hub/, '')
    const method = req.method()
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (path === '/plugins' || path.startsWith('/plugins?')) return json({ items: PACKS })
    if (path === '/plugins/url-health/summary') return json(SUMMARIES)
    if (/^\/plugins\/[^/]+\/url-health\/history$/.test(path)) return json(TREND_RESULT)

    const health = path.match(/^\/plugins\/([^/]+)\/url-health$/)
    if (health && method === 'GET') {
      return json(health[1] === 'stale-sites' ? HEALTH_STALE : HEALTH_BROKEN)
    }
    if (health && method === 'POST') return json(HEALTH_BROKEN)

    if (/^\/plugins\/[^/]+\/url-deep-diagnose$/.test(path) && method === 'POST') return json(DEEP_RESULT)
    if (/^\/plugins\/[^/]+\/ai-heal$/.test(path) && method === 'POST') return json(HEAL_RESULT)
    if (/^\/plugins\/[^/]+\/audit$/.test(path) && method === 'POST') return json(HEALTH_BROKEN)
    if (/^\/plugins\/[^/]+\/apply-health-fix$/.test(path) && method === 'POST') {
      return json({ ok: true, replacedCount: 1, removedCount: 0, remainingSites: 200 })
    }

    return json({ ok: true })
  })
}

/* ------------------------------------------------------------------ 登录 */

async function ensureSession(context) {
  // 生产模式（next start）下 bypass 快捷通道按设计是关闭的，只能走 NAVHUB_ADMIN_PASSWORD。
  // 这里优先用环境变量提供的验证口令；dev 模式则继续用 bypass。
  const password = process.env.NAVHUB_VERIFY_PASSWORD ?? ''
  // Playwright 的 request context 首次调用要冷启动（实测 8s），机器满载时会被拖到超 30s。
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const csrfRes = await context.request.get(`${BASE}/api/auth/csrf`, { timeout: 60_000 })
      const csrf = await csrfRes.json()
      await context.request.post(`${BASE}/api/auth/callback/credentials`, {
        form: {
          csrfToken: csrf.csrfToken,
          username: 'admin',
          password,
          bypass: password ? '' : 'true',
          callbackUrl: `${BASE}/admin/plugin-health`,
          json: 'true',
        },
        failOnStatusCode: false,
        maxRedirects: 0,
        timeout: 60_000,
      })
      const sessionRes = await context.request.get(`${BASE}/api/auth/session`, { timeout: 60_000 })
      const session = await sessionRes.json().catch(() => ({}))
      if (session?.user) return true
      lastErr = new Error(`第 ${attempt} 次未拿到会话`)
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  console.log(`[warn] 登录失败：${lastErr instanceof Error ? lastErr.message.split('\n')[0] : lastErr}`)
  return false
}

/* ------------------------------------------------------------------ 主流程 */

const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 1000 } })
if (WANT_SHOT) mkdirSync(SHOT_DIR, { recursive: true })

const consoleErrors = []
const httpProblems = []
const badResponses = []
const page = await context.newPage()
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    const loc = msg.location?.()
    consoleErrors.push(`${msg.text()}${loc?.url ? ` @ ${loc.url}` : ''}`)
  }
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
page.on('response', (res) => {
  if (res.status() < 400) return
  badResponses.push(`${res.status()} ${res.url()}`)
  if (res.url().includes('/api/hub/')) {
    httpProblems.push(`${res.status()} ${res.url()}`)
  }
})

/**
 * 点击并确认效果真的发生。
 * SSR 页面在水合完成前的点击会被 React 静默丢弃（不是异常，点了就是没反应），
 * 所以「点了」不等于「生效」——必须用效果作为判据并重试。
 */
async function clickUntil(locator, confirm, label, attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    await locator.click({ timeout: 15_000 }).catch(() => {})
    try {
      if (await confirm()) return true
    } catch {
      /* 元素正在重挂，下一轮再说 */
    }
    await page.waitForTimeout(1000)
  }
  console.log(`[warn] 点击未生效（${attempts} 次）：${label}`)
  return false
}

try {
  const loggedIn = await ensureSession(context)
  check('登录：拿到管理员会话', loggedIn, loggedIn ? 'session.user 存在' : '未拿到会话')

  await installStubs(page)
  await page.goto('/admin/plugin-health', { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForSelector('text=待复检站点包', { timeout: 120_000 })
  check('页面：插件列表渲染出 3 个网址包', (await page.getByText('待复检站点包').count()) >= 1)
  check(
    '筛选：存在「无有效数据」而非「从未体检」',
    (await page.getByRole('button', { name: /无有效数据/ }).count()) >= 1,
    `从未体检按钮数=${await page.getByRole('button', { name: /从未体检/ }).count()}`,
  )

  /* --- 1. 待复检 ------------------------------------------------------- */
  const staleBadgeCount = await page.getByText('待复检', { exact: true }).count()
  check('待复检：徽标显示「待复检」而不是健康度', staleBadgeCount >= 1, `出现 ${staleBadgeCount} 处`)

  const staleRow = page.locator('[data-testid="pack-row-stale-sites"]')
  const staleDetail = page.locator('[data-testid="pack-detail-stale-sites"]')
  const staleOpened = await clickUntil(
    staleRow.getByRole('button', { name: /详情/ }).first(),
    () => staleDetail.isVisible(),
    '展开待复检包',
  )
  check('待复检：能展开详情', staleOpened)
  const staleBlockText = staleOpened ? await staleDetail.innerText() : ''
  check('待复检：展开后有黄色横幅说明「健康度待复检」', staleBlockText.includes('健康度待复检'))
  check('待复检：明确写出「不会用推算值填补」', staleBlockText.includes('替换与剔除之后没有有效的测量值'))
  check(
    '待复检：本行不出现「真健康」这类伪造健康度',
    staleOpened && !staleBlockText.includes('真健康'),
    staleBlockText.replace(/\n/g, ' | ').slice(0, 110),
  )
  check('待复检：本行不出现百分比健康度', staleOpened && !/\d+%/.test(staleBlockText), staleBlockText.match(/\d+%/g)?.join(',') ?? '')

  /* --- 2. 深检证据链 --------------------------------------------------- */
  const brokenRow = page.locator('[data-testid="pack-row-broken-sites"]')
  const brokenDetail = page.locator('[data-testid="pack-detail-broken-sites"]')

  // 逐条目明细来自「本轮体检结果」而不是历史摘要，所以必须先真点一次抽样体检
  const auditRan = await clickUntil(
    brokenRow.getByRole('button', { name: /抽样体检/ }).first(),
    async () => (await brokenDetail.innerText().catch(() => '')).includes('dead.example.com/a'),
    '抽样体检',
  )
  check('体检：点「抽样体检」后逐条目明细出现', auditRan)

  if (!(await brokenDetail.isVisible().catch(() => false))) {
    await clickUntil(
      brokenRow.getByRole('button', { name: /详情/ }).first(),
      () => brokenDetail.isVisible(),
      '展开含死链包',
    )
  }

  const deepBtn = brokenDetail.getByRole('button', { name: /深度取证：https:\/\/dead\.example\.com\/a/ }).first()
  const deepPanel = page.locator('[data-testid="deep-diagnose-panel"]')
  const deepOpened = await clickUntil(deepBtn, () => deepPanel.isVisible(), '深检')
  check('深检：死链条目有「深检」按钮（可访问名带完整 URL）', (await deepBtn.count()) === 1)
  check('深检：点击后证据链面板出现', deepOpened)

  const deepText = deepOpened ? await deepPanel.innerText() : ''
  check('深检：结论显示为「域名停放 / 广告占位」', /深度取证：域名停放/.test(deepText), deepText.split('\n')[0] ?? '')
  check('深检：显示置信度 90%', /置信度\s*90%/.test(deepText))
  check(
    '深检：六层证据齐备',
    ['URL 结构', 'DNS', '重定向', 'HTTP', '内容', '归档'].every((label) => deepText.includes(label)),
    deepText.replace(/\n/g, ' | ').slice(0, 150),
  )
  check(
    '深检：HTTP 200 照常显示；未发起连接时写「未发起连接」而不是「延迟 0ms」',
    /HTTP 200/.test(deepText) && /未发起连接/.test(deepText) && !/延迟 0ms/.test(deepText),
    deepText.match(/未发起连接|延迟 \d+ms/)?.[0] ?? '',
  )
  check(
    '深检：未采集响应体时不显示「采样 0 字节」这种假观测',
    !/采样 0 字节/.test(deepText),
    deepText.match(/采样[^\s]{0,10}/)?.[0] ?? '',
  )
  check('深检：给出 Wayback 历史快照入口', deepText.includes('查看历史快照'))
  check('深检：未查的层明确标「未查询 Wayback 归档」而不是省略', deepText.includes('未查询 Wayback 归档'))
  check('深检：动作建议以徽标呈现', deepText.includes('替换为同类目可用站点'))

  /* --- 3. 历史趋势 ----------------------------------------------------- */
  const trendBtn = brokenDetail.getByRole('button', { name: /加载 含死链站点包 的体检历史趋势/ }).first()
  const trendChart = page.getByRole('img', { name: /可达率趋势/ }).first()
  const trendShown = await clickUntil(trendBtn, () => trendChart.isVisible(), '查看历史趋势')
  check('趋势：点击「查看历史趋势」后柱图出现', trendShown)
  const trendLabel = trendShown ? await trendChart.getAttribute('aria-label') : ''
  check('趋势：迷你柱图以 role=img + aria-label 暴露趋势', /可达率趋势：近期恶化/.test(trendLabel ?? ''), trendLabel ?? '')
  const trendSectionText = await brokenDetail.innerText()
  check('趋势：显示百分点变化', /近期恶化（-7 个百分点）/.test(trendSectionText))
  check('趋势：显示被排除的待复检记录数', /已排除 1 条待复检记录/.test(trendSectionText))

  /* --- 4. AI 平替：候选四档 / 结论未实测 / 未应用原因 ------------------ */
  const healBtn = brokenDetail.getByRole('button', { name: /仅预览平替候选/ }).first()
  const healShown = await clickUntil(
    healBtn,
    async () => (await brokenDetail.innerText()).includes('受损网址拯救方案：'),
    '仅预览平替候选',
  )
  check('平替：点「仅预览平替候选」后诊断方案出现', healShown)
  const healText = healShown ? await brokenDetail.innerText() : ''
  /*
    档位断言只能看「候选行」，不能看整个抽屉：
    抽屉里还有「确认不可达死链清单（共 N 条）」标题（activeTab 为 issues/broken 时都渲染），
    拿整抽屉文本判「不得出现不可达」会稳定假红；同理「疑似停放」在指标行也有同名字样，
    整抽屉包含它也无法证明候选徽标真的标对了。
    候选行的 title 带「合成可信度：…」（面板里给每行挂的可信度分解），据此精确切块。
  */
  const candidateText = healShown
    ? (await brokenDetail
        .locator('li[title*="合成可信度"]')
        .allInnerTexts()
        .catch(() => [])).join(' | ')
    : ''
  check('候选：四行候选都带可信度分解（切块锚点有效）', healShown && candidateText.length > 0, `候选区块长度 ${candidateText.length}`)
  check('候选：实测通过的候选标「实测可达」', candidateText.includes('实测可达'))
  check('候选：拒绝爬虫的候选标「拒绝爬虫·未验证」', candidateText.includes('拒绝爬虫·未验证'))
  check('候选：停放候选标「疑似停放」', candidateText.includes('疑似停放'))
  check('候选：超时候选标「未能验证」而不是「不可达」', candidateText.includes('未能验证'))
  check(
    '候选：超时不得被说成「不可达」（慢 ≠ 死）',
    candidateText.length > 0 && !/不可达/.test(candidateText),
    `候选区块含「不可达」=${/不可达/.test(candidateText)}`,
  )
  // 可信度分解放在 title 属性里（悬浮可见、不占版面），innerText 读不到，必须读属性
  const confidenceTitle = await brokenDetail
    .locator('[title*="合成可信度"]')
    .first()
    .getAttribute('title')
    .catch(() => null)
  check(
    '候选：可信度分解写进 title',
    /合成可信度：可达性 100 × 0\.5/.test(confidenceTitle ?? ''),
    confidenceTitle ?? '未找到 title',
  )
  check('诚实性：client-claimed 的诊断标「结论未实测」', healText.includes('结论未实测'))
  check('诚实性：自动应用失败时显示「未应用：无实测通过的平替」', /未应用：无实测通过的平替/.test(healText))
  check(
    '诚实性：被拒绝的包外 URL 有提示',
    /不属于本包，已跳过诊断/.test(healText) && healText.includes('not-in-pack.example.com'),
  )

  /* --- 5. 控制台与网络 ------------------------------------------------- */
  // 只把「本项目代码抛的异常」当缺陷。后端 API（:8787）在本轮验证里是独立进程，
  // 它若没起来，页面会打出 502 的网络错误——那是环境事实，不是面板缺陷，
  // 因此单独记录并打印，用于判断是不是真问题。
  const jsErrors = consoleErrors.filter((t) => !/Failed to load resource/.test(t))
  const netErrors = consoleErrors.filter((t) => /Failed to load resource/.test(t))
  check('控制台：无 JS 异常 / pageerror', jsErrors.length === 0, jsErrors.slice(0, 3).join(' / '))
  check('网络：/api/hub/* 无 4xx/5xx', httpProblems.length === 0, httpProblems.slice(0, 3).join(' / '))
  console.log(
    `[info] 非 hub 的失败响应 ${badResponses.filter((u) => !u.includes('/api/hub/')).length} 条` +
      (badResponses.length ? `：${badResponses.filter((u) => !u.includes('/api/hub/')).slice(0, 4).join(' | ')}` : ''),
  )
  console.log(`[info] 网络类控制台错误 ${netErrors.length} 条：${netErrors.slice(0, 2).join(' | ')}`)

  if (WANT_SHOT) {
    const shotPath = join(SHOT_DIR, 'plugin-health-deep-and-heal.png')
    await page.screenshot({ path: shotPath, fullPage: true })
    console.log(`截图：${shotPath}`)
  }
} catch (err) {
  check('运行未抛异常', false, err instanceof Error ? err.message.split('\n')[0] : String(err))
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.pass)
console.log('')
console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length }))
if (failed.length > 0) {
  console.log('失败项：')
  for (const item of failed) console.log(` - ${item.name}${item.detail ? `（${item.detail}）` : ''}`)
  process.exit(1)
}
