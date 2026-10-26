import { chromium } from '@playwright/test'

const BASES = [
  { name: 'dev', base: 'http://127.0.0.1:3000' },
  { name: 'prod', base: 'http://127.0.0.1:3210' },
]
const QUERIES = ['代码', 'AI', 'GitHub', '设计', '视频']

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
})

for (const { name, base } of BASES) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  const bad = []
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`) })
  try {
    await page.goto(base + '/', { waitUntil: 'load', timeout: 120000 })
    await page.waitForTimeout(2500)
    const sel = 'input[placeholder*="搜索"], input[type="search"], input[aria-label*="搜索"], input[role="searchbox"]'
    const box = await page.$(sel)
    if (!box) { console.log(`## ${name}: 未找到搜索框`); await page.close(); continue }

    for (const q of QUERIES) {
      await box.click()
      await page.keyboard.press('Control+A')
      await page.keyboard.press('Backspace')
      await box.type(q, { delay: 30 })
      await page.waitForTimeout(1800)
      const info = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('[role="option"], [data-suggestion], li a[href*="/site/"]'))
        return {
          count: items.length,
          sample: items.slice(0, 3).map((e) => (e.textContent || '').trim().slice(0, 30)),
          dropdownVisible: Boolean(document.querySelector('[role="listbox"], [data-radix-popper-content-wrapper], [cmdk-list]')),
        }
      })
      console.log(`## ${name} q="${q}" -> ${JSON.stringify(info)}`)
      // 清空
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    console.log(`## ${name} 4xx/5xx: ${bad.length ? bad.join(' | ') : 'none'}`)
  } catch (e) {
    console.log(`## ${name} ERROR ${String(e).slice(0, 160)}`)
  }
  await page.close()
}

await browser.close()
console.log('=== SEARCH COMPARE DONE ===')
