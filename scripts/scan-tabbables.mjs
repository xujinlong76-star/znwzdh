
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  const report = await page.evaluate(() => {
    const isTabbable = (el) => {
      if (el.disabled) return false
      const ti = el.getAttribute('tabindex')
      if (ti !== null) { const n = parseInt(ti, 10); return !isNaN(n) && n >= 0 }
      return ['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(el.tagName) && el.getAttribute('href') !== null || ['BUTTON','INPUT','SELECT','TEXTAREA'].includes(el.tagName)
    }
    const all = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(isTabbable)
    const h1 = Array.from(document.querySelectorAll('h1'))
    const main = document.querySelector('#main-content')
    const inMain = all.filter(el => main && main.contains(el))
    // display:none / visibility:hidden 的元素键盘根本到不了（典型：桌面端隐藏的移动端分类芯片）。
    // 真正的 Tab 停留点必须按可渲染口径统计，否则会把「看不见但写着 tabindex」的节点也计入。
    const isRendered = (el) => {
      if (el.getClientRects().length === 0) return false
      const s = getComputedStyle(el)
      return s.display !== 'none' && s.visibility !== 'hidden'
    }
    const inMainRendered = inMain.filter(isRendered)

    // 卡片内 tab 停留点
    const cardStops = Array.from(document.querySelectorAll('[data-navhub-site-id]')).map(c => ({
      id: c.getAttribute('data-navhub-site-id'),
      stops: Array.from(c.querySelectorAll('a[href],button,[tabindex]')).filter(isTabbable).length,
      title: c.textContent.trim().slice(0, 20)
    }))
    const badCards = cardStops.filter(c => c.stops > 1)

    // 最小的目标
    const small = all.map(el => {
      const r = el.getBoundingClientRect()
      return { tag: el.tagName, w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().slice(0, 24) }
    }).filter(x => x.w > 0 && x.h > 0 && (x.w < 24 || x.h < 24))
    const smallBySize = {}
    for (const s of small) { const k = s.w + 'x' + s.h; smallBySize[k] = (smallBySize[k] || 0) + 1 }

    return {
      totalTabbables: all.length,
      tabbablesInMain: inMain.length,
      /** 真正键盘可达的主内容停留点（排除 display:none / visibility:hidden） */
      tabbablesInMainRendered: inMainRendered.length,
      h1Text: h1.map(h => h.textContent.trim().slice(0, 40)),
      h1Count: h1.length,
      cardsWithMultipleStops: badCards.length,
      sampleBadCards: badCards.slice(0, 5),
      smallTargets: small.length,
      smallSizeHistogram: Object.entries(smallBySize).sort((a,b)=>b[1]-a[1]).slice(0,8),
      smallSamples: small.slice(0, 10)
    }
  })
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
})()
