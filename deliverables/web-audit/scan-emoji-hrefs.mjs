import fs from 'node:fs'

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3210'
const d = JSON.parse(fs.readFileSync('deliverables/web-audit/crawl-results.json', 'utf8'))
const urls = [...new Set(d.results.map((p) => p.url))]

const EMOJI_ICONS = ['🐙', '🔌', '🧵', '🔀', '🐛', '🔎', '📄', '🎯', '✨', '💡', '⚡', '🔮', '🌐', '📘', '📑', '🧠', '🧭', '💓']

const hits = []
let i = 0
async function worker() {
  while (i < urls.length) {
    const u = urls[i++]
    try {
      const html = await (await fetch(u, { signal: AbortSignal.timeout(60000) })).text()
      // 抓所有 href（含相对路径），检查是否含 emoji 或百分号编码的 emoji
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])
      const bad = []
      for (const h of hrefs) {
        let dec = h
        try { dec = decodeURIComponent(h) } catch {}
        if (EMOJI_ICONS.some((e) => dec.includes(e))) bad.push(dec)
      }
      // 也检查以 emoji 开头的 href（相对路径）
      const relEmoji = hrefs.filter((h) => /^[^\x00-\x7F]/.test(h) || /^%[0-9A-F]{2}/i.test(h))
      if (bad.length || relEmoji.length) {
        hits.push({ page: new URL(u).pathname, hrefs: [...new Set([...bad, ...relEmoji])].slice(0, 12) })
      }
    } catch {}
  }
}
await Promise.all(Array.from({ length: 6 }, worker))

console.log('=== 含 emoji href 的页面 (' + hits.length + ') ===')
for (const h of hits) {
  console.log('## ' + h.page)
  for (const x of h.hrefs) console.log('     ' + x)
}
fs.writeFileSync('deliverables/web-audit/emoji-href-pages.json', JSON.stringify(hits, null, 2))
console.log('=== EMOJI HREF SCAN DONE ===')
