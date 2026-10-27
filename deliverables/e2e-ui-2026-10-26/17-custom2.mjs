/**
 * /custom 第二次取证：把「模版切换 / 背景样式 / 编辑预览 / 模块内动作」全部用
 * localStorage 布局串 + 画布文本指纹 + 请求列表 三个客观信号判定。
 * 上一轮只测了当前已激活的模版，那本来就是 no-op，不能算缺陷。
 */
import { session, open, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const s = await session({ auth: true })
const { page } = s
const reqs = []
page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(r.method() + ' ' + r.url().split('/api/')[1]) })

await open(page, '/custom', { settle: 4500 })

const snap = () =>
  page.evaluate(() => {
    const main = document.querySelector('main')
    let lsLen = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || ''
      if (/diy|modular|layout|module/i.test(k)) lsLen += (localStorage.getItem(k) || '').length
    }
    return {
      lsLen,
      textSig: (main?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
      textLen: (main?.innerText || '').length,
      cards: main?.querySelectorAll('button').length || 0,
      pressed: [...(main?.querySelectorAll('button[aria-pressed],button[data-state]') || [])]
        .map((b) => (b.textContent || '').trim().slice(0, 12) + '#' + (b.getAttribute('aria-pressed') ?? b.getAttribute('data-state')))
        .slice(0, 12),
    }
  })

const rows = []
for (const label of [
  '⚡ 极速效率启动坞',
  '🎨 创作者灵感画布',
  '点阵', '网格', '极光', '纯净',
  '自定义排版',
  '编辑', '预览',
  '重新生成', '复制 UUID',
]) {
  const loc = page.locator(`main button:has-text("${label}")`).first()
  const found = (await loc.count()) > 0
  const vis = found ? await loc.isVisible().catch(() => false) : false
  let res = null
  if (found && vis) {
    const before = await snap()
    reqs.length = 0
    await loc.scrollIntoViewIfNeeded().catch(() => {})
    await loc.click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(1600)
    const after = await snap()
    res = {
      ls: before.lsLen + ' -> ' + after.lsLen,
      textChanged: after.textSig !== before.textSig,
      btnCount: before.cards + ' -> ' + after.cards,
      pressed: after.pressed.join(', '),
      reqs: reqs.slice(0, 6),
    }
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(400)
  }
  rows.push({ label, found, vis, ...(res || {}) })
  console.log(`[custom2] ${label} 命中=${found} 可见=${vis} ${JSON.stringify(res || {})}`)
}

writeFileSync(OUT + '17-custom2.json', JSON.stringify({ base: BASE, rows }, null, 2))
console.log('\n[saved] 17-custom2.json')
await s.browser.close()
