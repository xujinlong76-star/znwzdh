/**
 * 可交互延迟实测：把「按钮点了没反应」和「点了但页面还没 hydrated」分开。
 *
 * 做法：加载页面后每 500ms 真点一次同一个控件，记录「第一次产生预期响应」
 * 发生在加载后多少毫秒；同时采样长任务与 hydration 完成点。
 * 若首次生效远晚于 DOM 就绪，问题属于首屏可交互延迟，而不是控件失效。
 */
import { session, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const PROBES = [
  { route: '/', label: '微工具箱', role: 'button', expect: 'dialog', note: '工具栏图标按钮（Radix Dialog）' },
  { route: '/', label: '快捷键指南', role: 'button', expect: 'dialog', note: '工具栏图标按钮（Radix Dialog）' },
  { route: '/', label: '__slash__', role: 'key', expect: 'dialog', note: '键盘 / 唤出全局搜索面板' },
  { route: '/marketplace', label: '__select__', role: 'select', expect: 'text', note: '原生 select 改值后主区文案是否变' },
  { route: '/videos', label: '精选视频', role: 'button', expect: 'text', note: '视频墙筛选标签' },
]

/**
 * 判定信号：
 *  - dialog —— 页面上 [role="dialog"] 的数量（弹层类控件）
 *  - text   —— main 的 innerText 长度（列表/筛选类控件：内容变了才算响应）
 * 用「长度」而不是「卡片数」，是因为卡片选择器在不同页面写法不一致。
 */
async function signal(page, expect) {
  return page.evaluate(
    (kind) => {
      if (kind === 'dialog') return document.querySelectorAll('[role="dialog"]').length
      return (document.querySelector('main')?.innerText || '').length
    },
    expect
  )
}

const results = []
for (const p of PROBES) {
  const s = await session()
  const { page } = s
  const t0 = Date.now()
  await page.goto(p.route.startsWith('http') ? p.route : BASE + p.route, { waitUntil: 'domcontentloaded' })
  const domReady = Date.now() - t0
  let firstEffect = null
  let attempts = 0
  const timeline = []
  // 基线必须在第一次点击之前取，否则「第一次就成功」会被当成基线本身而漏记
  const baseline = await signal(page, p.expect).catch(() => 0)
  // 每轮：点一次 → 等 500ms → 读信号；连续 30 轮（≈15s）仍未生效即判「不是延迟，是真没响应」
  while (attempts < 30 && firstEffect === null) {
    attempts++
    try {
      if (p.role === 'key') {
        await page.keyboard.press('/')
      } else if (p.role === 'select') {
        const sel = page.locator('select').first()
        const vals = await sel.evaluate((e) => e.options.length).catch(() => 0)
        if (vals > 1) await sel.selectOption({ index: attempts % vals }).catch(() => {})
      } else {
        await page.locator(`button:has-text("${p.label}")`).first().click({ timeout: 400 }).catch(() => {})
      }
    } catch {}
    await page.waitForTimeout(500)
    const now = await signal(page, p.expect).catch(() => 0)
    timeline.push({ at: Date.now() - t0, value: now })
    if (now !== baseline) firstEffect = Date.now() - t0
  }
  const extra = await page
    .evaluate(() => {
      const v = window.__v || {}
      return { lcp: Math.round(v.lcp || 0), longTasks: (v.long || []).length, longMs: (v.long || []).reduce((a, b) => a + b, 0), inp: Math.round(v.inp || 0) }
    })
    .catch(() => ({}))
  results.push({ ...p, domReady, attempts, firstEffectMs: firstEffect, timeline: timeline.slice(0, 26), extra })
  console.log(`[tta] ${p.route} ${p.label} domReady=${domReady}ms 首次生效=${firstEffect ?? '>20s(未生效)'} 次=第${attempts}次点击 长任务=${extra.longTasks || '?'}(${extra.longMs || 0}ms) INP=${extra.inp}`)
  console.log('     时间线: ' + timeline.map((t) => `${t.at}ms:${t.value}`).join(' '))
  await s.browser.close()
}

writeFileSync(OUT + '11-interactive.json', JSON.stringify({ base: BASE, results }, null, 2))
console.log('\n[saved] 11-interactive.json')
