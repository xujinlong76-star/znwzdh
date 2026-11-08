
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })

  const queries = [
    '帮我把会议录音自动整理成文字纪要',      // 纯语义：与站点标题无字面重叠
    '画一张好看的封面图',                    // 纯语义
    'kimi',                                  // 字面命中（对照）
    'jianli'                                 // 拼音（对照）
  ]
  for (const q of queries) {
    const r = await page.evaluate(async (query) => {
      const resp = await fetch('/api/hub/search?q=' + encodeURIComponent(query) + '&limit=5')
      const j = await resp.json()
      const hits = (j.hits || []).slice(0, 5).map(h => ({
        title: h.site?.title,
        channels: Object.keys(h.contributions || {}),
        semantic: h.contributions?.semantic ? h.contributions.semantic.rank : null
      }))
      return { count: (j.hits || []).length, hits }
    }, q)
    console.log('Q: ' + q)
    console.log('   hits=' + r.count)
    for (const h of r.hits) console.log('   - ' + h.title + '  [' + h.channels.join(',') + ']')
  }
  await browser.close()
})()
