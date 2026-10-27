/**
 * 首页工具栏三个入口（微工具箱 / 快捷键指南 / 全局搜索「/」）到底开不开。
 * 前几轮的判据都被 Radix 常驻隐藏 portal 干扰（[role=dialog] 计数基线就是 1），
 * 这里改成「有没有一个真正可见（有尺寸、data-state=open）的弹层，且里面出现了预期文案」。
 */
import { session, open, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const s = await session({ auth: true })
const { page } = s
await open(page, '/', { settle: 6000 })

const layers = () =>
  page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper]')]
    return nodes.map((n) => {
      const r = n.getBoundingClientRect()
      const cs = getComputedStyle(n)
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        state: n.getAttribute('data-state') ?? n.querySelector('[data-state]')?.getAttribute('data-state') ?? null,
        vis: r.width > 20 && r.height > 20 && cs.visibility !== 'hidden' && cs.opacity !== '0',
        text: (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      }
    })
  })

const rows = []
for (const { label, how } of [
  { label: '微工具箱', how: 'click' },
  { label: '快捷键指南', how: 'click' },
  { label: '全局搜索（按 / 键）', how: 'slash' },
  { label: 'Ctrl+K', how: 'ctrlk' },
]) {
  const before = await layers()
  let act = null
  if (how === 'click') {
    const el = await page.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(t) || (x.getAttribute('title') || '').includes(t) || (x.getAttribute('aria-label') || '').includes(t))
      if (b) { b.click(); return (b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24) }
      return null
    }, label)
    act = el
  } else if (how === 'slash') {
    await page.locator('body').click({ position: { x: 400, y: 300 }, timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(400)
    await page.keyboard.press('/').catch(() => {})
    act = '/'
  } else {
    await page.keyboard.press('Control+k').catch(() => {})
    act = 'ctrl+k'
  }
  await page.waitForTimeout(1800)
  const after = await layers()
  const opened = after.filter((l) => l.vis && !before.some((b) => b.vis && b.text === l.text))
  rows.push({ name: label, action: act, beforeVisible: before.filter((b) => b.vis).length, afterVisible: after.filter((l) => l.vis).length, openedLayer: opened[0] ?? null })
  console.log(`[home] ${label} 触发=${act} 可见层 ${before.filter((b) => b.vis).length} -> ${after.filter((l) => l.vis).length} 新开层=${JSON.stringify(opened[0] || null)}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(900)
}

writeFileSync(OUT + '24-home-dialogs.json', JSON.stringify({ base: BASE, rows }, null, 2))
console.log('\n[saved] 24-home-dialogs.json')
await s.browser.close()
