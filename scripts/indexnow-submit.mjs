#!/usr/bin/env node
/**
 * IndexNow 全站提交：把两个 sitemap 里的全部 URL 推送给 IndexNow
 * （Bing / Yandex / Naver 等参与引擎即刻收录）。
 *
 * 用法（上线后，域名已部署且环境变量已注入时跑）：
 *   NAVHUB_SITE_URL=https://example.com NAVHUB_INDEXNOW_KEY=<key> \
 *     node scripts/indexnow-submit.mjs [--dry-run]
 *
 * - keyLocation 恒指向站点的 /indexnow-key.txt 路由（运行时读 env，
 *   不依赖构建期 rewrite 的 /{key}.txt）。
 * - --dry-run 只打印将提交的 URL 数与样本，不发请求，先看清单再真推。
 * - token/key 只从环境变量读，绝不写进仓库。
 */
const origin = (process.env.NAVHUB_SITE_URL || '').trim().replace(/\/+$/, '')
const key = (process.env.NAVHUB_INDEXNOW_KEY || '').trim()
const dryRun = process.argv.includes('--dry-run')

if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) {
  console.error('缺少或非法的 NAVHUB_SITE_URL（应为纯 origin，如 https://example.com）')
  process.exit(1)
}
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
  console.error('缺少或非法的 NAVHUB_INDEXNOW_KEY（8–128 位字母数字/连字符）')
  process.exit(1)
}

const SITEMAPS = ['/sitemap.xml', '/videos/sitemap.xml']
const BATCH = 10_000

async function fetchLocs(path) {
  const res = await fetch(`${origin}${path}`)
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  const xml = await res.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter(Boolean)
}

const urls = [...new Set((await Promise.all(SITEMAPS.map(fetchLocs))).flat())]
console.log(`sitemap 共 ${urls.length} 条 URL`)
console.log('样本:', urls.slice(0, 3).join(' | '))

if (dryRun) {
  console.log('[dry-run] 未发送任何请求')
  process.exit(0)
}

const host = new URL(origin).host
for (let i = 0; i < urls.length; i += BATCH) {
  const batch = urls.slice(i, i + BATCH)
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: `${origin}/indexnow-key.txt`,
      urlList: batch,
    }),
  })
  console.log(`批次 ${i / BATCH + 1}：${batch.length} 条 -> HTTP ${res.status}`)
  if (!res.ok && res.status !== 202) {
    console.error(await res.text())
    process.exit(1)
  }
}
console.log('提交完成')
