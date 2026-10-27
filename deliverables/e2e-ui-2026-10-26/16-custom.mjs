/**
 * /custom 的「模版/模块」按钮到底做了什么：
 * 只看 DOM 文本差会把「写进 localStorage 但不改当前画布」误判成没反应，
 * 这里同时取 dialog 数、模块节点数、localStorage 布局串长度、toast。
 */
import { session, open, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const s = await session({ auth: true })
const { page } = s
await open(page, '/custom', { settle: 4500 })

const snap = () =>
  page.evaluate(() => {
    const main = document.querySelector('main')
    const ls = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || ''
      if (/diy|modular|layout|module/i.test(k)) ls[k] = (localStorage.getItem(k) || '').length
    }
    return {
      buttons: [...(main?.querySelectorAll('button') || [])].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20)).filter(Boolean).slice(0, 26),
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      modules: document.querySelectorAll('[data-module-id], [draggable="true"], [aria-label*="模块"]').length,
      ls,
      text: (main?.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
    }
  })

const rows = []
const base = await snap()
let prev = base
for (const label of ['💻 全栈极客工作台', '时钟', 'UUID', '套用模版']) {
  const loc = page.locator(`main button:has-text("${label}")`).first()
  const found = (await loc.count()) > 0
  const vis = found ? await loc.isVisible().catch(() => false) : false
  let res = null
  if (found && vis) {
    await loc.scrollIntoViewIfNeeded().catch(() => {})
    await loc.click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(1800)
    const after = await snap()
    res = {
      dialogDelta: after.dialogs - prev.dialogs,
      moduleDelta: after.modules - prev.modules,
      lsChanged: JSON.stringify(after.ls) !== JSON.stringify(prev.ls),
      textChanged: after.text !== prev.text,
      after: { dialogs: after.dialogs, modules: after.modules, ls: after.ls },
    }
    prev = after
    // 关掉可能弹出的对话框，别影响下一轮
    await page.keyboard.press('Escape')
    await page.waitForTimeout(700)
    prev = await snap()
  }
  rows.push({ label, found, vis, ...(res || {}) })
  console.log(`[custom] ${label} 命中=${found} 可见=${vis} ${JSON.stringify(res || {})}`)
}
console.log('  基线 buttons=' + JSON.stringify(base.buttons))
console.log('  基线 dialogs=' + base.dialogs, 'modules=' + base.modules, 'ls=' + JSON.stringify(base.ls))

writeFileSync(OUT + '16-custom.json', JSON.stringify({ base: BASE, baseSnap: base, rows }, null, 2))
console.log('\n[saved] 16-custom.json')
await s.browser.close()
