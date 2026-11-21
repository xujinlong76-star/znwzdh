#!/usr/bin/env node
/**
 * 首屏露出探针（2026-11-21 从根目录 measure-firstscreen.mjs 重写而来）。
 *
 * 为什么重写而不是搬过来：原脚本硬编码了 CI 容器里的
 *   - Linux headless shell 路径（/home/hatch/.cache/ms-playwright/...）
 *   - 固定端口 3100 / 3120 / 3121
 * 在开发机上**完全跑不起来**，属于一次性产物。这里改成：
 *   - 不指定 executablePath，交给 Playwright 自己找已安装的浏览器；
 *   - baseUrl 走命令行参数 / 环境变量，默认 http://127.0.0.1:3111；
 *   - 视口档位可配置，默认覆盖 1024/1280/1440/1920 四档；
 *   - 输出机器可读 JSON，可接 CI 做趋势对比。
 *
 * 度量口径（与 e2e/category-block-a11y.spec.ts 的断言同源）：
 *   - firstCardTop     首张卡片顶部距视口顶部的像素与百分比（越小越好）
 *   - fullyVisibleCards 完全落在视口内的卡片数（不含被裁切的）
 *   - visibleRows       可见卡片行数
 *   - cols              真实列数（读 data-grid-cols，ResizeObserver 写入）
 *   - orphanGroups      卡片数不是列数整倍数的分组数（应为 0）
 *
 * 用法：
 *   node scripts/perf/first-screen.mjs
 *   node scripts/perf/first-screen.mjs --base http://127.0.0.1:3111
 *   node scripts/perf/first-screen.mjs --viewports 1024x768,1440x900 --json out.json
 */

import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

function parseArgs(argv) {
  const args = { base: process.env.NAVHUB_BASE_URL || 'http://127.0.0.1:3111', viewports: null, json: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i]
    else if (argv[i] === '--viewports') args.viewports = argv[++i]
    else if (argv[i] === '--json') args.json = argv[++i]
  }
  if (args.viewports) {
    args.viewports = args.viewports.split(',').map((s) => {
      const [w, h] = s.split('x').map(Number)
      return { width: w || 1440, height: h || 900 }
    })
  } else {
    args.viewports = [
      { width: 1024, height: 768 },
      { width: 1280, height: 800 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]
  }
  return args
}

/** 在页面里跑一次度量，返回该视口的首屏指标。 */
async function measure(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height })

  // data-grid-cols 由 ResizeObserver 异步写入：必须等它落地，
  // 否则会在「列数还是 undefined」的首帧上误判成孤儿行。
  await page.waitForFunction(
    () => {
      const grids = Array.from(document.querySelectorAll('[data-nav-grid]'))
      return grids.length > 0 && grids.every((g) => Number(g.dataset.gridCols) > 0)
    },
    undefined,
    { timeout: 15_000 },
  )

  return page.evaluate(() => {
    const vh = window.innerHeight
    const cards = Array.from(document.querySelectorAll('.nav-card-deferred'))
    const first = cards[0]?.getBoundingClientRect()

    const fullyVisible = cards.filter((c) => {
      const r = c.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= vh
    }).length

    const rows = [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top)))].sort(
      (a, b) => a - b,
    )

    const grids = Array.from(document.querySelectorAll('[data-nav-grid]')).filter(
      (g) => g.querySelectorAll(':scope > .nav-card-deferred').length > 0,
    )
    const cols = grids[0] ? Number(grids[0].dataset.gridCols) || 0 : 0
    const orphanGroups = cols
      ? grids.filter((g) => g.querySelectorAll(':scope > .nav-card-deferred').length % cols !== 0)
          .length
      : 0

    return {
      firstCardTop: first ? Math.round(first.top) : null,
      firstCardTopPct: first ? Number(((first.top / vh) * 100).toFixed(1)) : null,
      fullyVisibleCards: fullyVisible,
      visibleRows: rows.length,
      cols,
      orphanGroups,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }
  })
}

/**
 * 启动浏览器：优先用 Playwright 自带浏览器，失败再回退到系统 Chrome/Edge。
 *
 * 为什么需要回退：Playwright 的默认 playwight_browser 是 headless shell，
 * 很多开发机/CI 只装了完整 chromium 或系统 Chrome（本项目开发机就是后者）。
 * 原 measure-firstscreen.mjs 把 Linux headless shell 路径写死，直接导致
 * 换机器就跑不起来。这里用「尝试 → 回退」而不是硬编码路径。
 */
async function launchBrowser() {
  const attempts = [
    { label: 'Playwright 默认', opts: { headless: true } },
    { label: '系统 Chrome', opts: { headless: true, channel: 'chrome' } },
    { label: '系统 Edge', opts: { headless: true, channel: 'msedge' } },
  ]
  const errors = []
  for (const a of attempts) {
    try {
      const browser = await chromium.launch(a.opts)
      console.log(`[first-screen] 浏览器：${a.label}`)
      return browser
    } catch (err) {
      errors.push(`${a.label}: ${err instanceof Error ? err.message.split('\n')[0] : err}`)
    }
  }
  throw new Error(`无法启动任何浏览器：\n  ${errors.join('\n  ')}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const browser = await launchBrowser()
  const results = []

  try {
    const context = await browser.newContext({ viewport: args.viewports[0] })
    const page = await context.newPage()
    await page.goto(args.base, { waitUntil: 'networkidle', timeout: 180_000 })

    for (const vp of args.viewports) {
      const m = await measure(page, vp)
      results.push({ viewport: `${vp.width}x${vp.height}`, ...m })
    }
  } finally {
    await browser.close()
  }

  const summary = { base: args.base, generatedAt: new Date().toISOString(), results }

  console.log('='.repeat(78))
  console.log(`[first-screen] ${args.base}`)
  console.log(
    'viewport'.padEnd(12),
    '首卡 top'.padStart(10),
    '占比'.padStart(8),
    '完整卡'.padStart(7),
    '列数'.padStart(5),
    '孤儿组'.padStart(7),
    '横向溢出'.padStart(9),
  )
  for (const r of results) {
    console.log(
      r.viewport.padEnd(12),
      String(r.firstCardTop ?? '-').padStart(10),
      `${r.firstCardTopPct ?? '-'}%`.padStart(8),
      String(r.fullyVisibleCards).padStart(7),
      String(r.cols).padStart(5),
      String(r.orphanGroups).padStart(7),
      String(r.horizontalOverflow ? '是' : '否').padStart(9),
    )
  }
  console.log('='.repeat(78))

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(summary, null, 2), 'utf8')
    console.log(`[first-screen] JSON 已写入 ${args.json}`)
  }

  // 门禁用：任何一档出现孤儿组或横向溢出，退出码 1
  const broken = results.some((r) => r.orphanGroups > 0 || r.horizontalOverflow)
  if (broken) process.exitCode = 1
}

main().catch((err) => {
  console.error('[first-screen] 失败：', err)
  process.exitCode = 1
})
