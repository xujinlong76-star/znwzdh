/**
 * 定向取证（把「无响应」判成缺陷还是判成采集器盲区，必须用对信号）
 * 每个检查项都记录「用什么信号判定」，避免把检测器局限写成功能缺陷。
 */
import { session, open, state, BASE, OUT, clickText } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const out = {}
const log = (...a) => console.log(...a)

/** 页面点一次控件后，把「真实发生过的可观测变化」全部收集回来 */
async function watch(page, fn, { settle = 2500 } = {}) {
  const reqsBefore = []
  const onReq = (r) => { if (!r.url().startsWith(BASE)) return; const u = new URL(r.url()); if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/_next/')) reqsBefore.push(`${r.method()} ${u.pathname}${u.search.slice(0, 40)}`) }
  const pages = []
  page.context().on('page', (p) => pages.push(p.url().catch(() => '?')))
  page.on('request', onReq)
  const before = await state(page)
  const domBefore = await page.evaluate(() => document.querySelectorAll('*').length)
  const t0 = Date.now()
  const info = await fn()
  await page.waitForTimeout(settle)
  const after = await state(page).catch(() => null)
  const domAfter = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => domBefore)
  page.off('request', onReq)
  return {
    info,
    ms: Date.now() - t0,
    reqs: [...new Set(reqsBefore)].slice(0, 12),
    newTabs: pages.length,
    domDelta: domAfter - domBefore,
    textSigChanged: !!after && after.textSig !== before.textSig,
    svgChanged: !!after && after.svgSig !== before.svgSig,
    popupChanged: !!after && (after.popup || 0) !== (before.popup || 0),
    toast: after?.toast?.slice(-2) || [],
    url: after?.url,
  }
}

// ---------- 1) 插件安装闭环 ----------
{
  const s = await session({ auth: true })
  const { page } = s
  await open(page, '/marketplace', { settle: 3000 })
  const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"],button')].map((e) => ({
    t: e.tagName, role: e.getAttribute('role'), txt: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
    sel: e.getAttribute('aria-selected'), ds: e.getAttribute('data-state'), cls: e.className.slice(0, 60),
  })).filter((x) => x.txt).slice(0, 24))
  // 找一张卡片上的「安装」按钮
  const installBtn = page.locator('button:has-text("安装")').first()
  const hasInstall = await installBtn.isVisible().catch(() => false)
  let detail = null
  if (hasInstall) {
    detail = await watch(page, async () => {
      await installBtn.click({ timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(1200)
      const dlg = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
      const c = await clickText(page, /确认|安装|确定/, { timeout: 4000 })
      return { dlg, confirm: c.clicked }
    })
  }
  await open(page, '/marketplace/installed', { settle: 3000 })
  const inst = await page.evaluate(() => {
    const txt = document.querySelector('main')?.innerText || ''
    const cnt = [...document.querySelectorAll('button,[role="tab"]')].map((e) => e.textContent || '').filter((s) => /全部\s*\(\d+\)/.test(s))
    return { head: txt.replace(/\s+/g, ' ').slice(0, 200), counts: cnt.slice(0, 3), cards: document.querySelectorAll('[data-navhub-site-id], [class*="rounded-xl"]').length }
  })
  const api = await page.evaluate(async () => {
    const r = {}
    for (const p of ['/api/plugins/installed', '/api/plugins']) {
      try { const x = await fetch(p, { credentials: 'include' }); const j = await x.json().catch(() => null); r[p] = `${x.status} items=${Array.isArray(j?.items) ? j.items.length : Array.isArray(j?.data) ? j.data.length : Array.isArray(j) ? j.length : JSON.stringify(j).slice(0, 60)}` } catch (e) { r[p] = 'ERR' }
    }
    return r
  })
  out.install = { tabs, hasInstall, detail, installedPage: inst, api }
  log('[install] 卡片有安装按钮=' + hasInstall, JSON.stringify(detail?.info || {}), '已安装页=' + JSON.stringify(inst.counts), JSON.stringify(api))
  await s.browser.close()
}

// ---------- 2) /videos 筛选 + 卡片 ----------
{
  const s = await session()
  const { page } = s
  await open(page, '/videos', { settle: 3500 })
  const meta = await page.evaluate(() => ({
    cards: document.querySelectorAll('a[href*="/videos/"], [data-video-id], video').length,
    mainHead: (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
    filters: [...document.querySelectorAll('button')].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16))
      .filter((t) => t && t.length < 12).slice(0, 20),
  }))
  const res = []
  for (const label of ['精选视频', '语文', '七年级']) {
    const w = await watch(page, async () => {
      const b = page.locator(`button:has-text("${label}")`).first()
      await b.click({ timeout: 4000 }).catch(() => {})
      return { label, found: await b.count() }
    }, { settle: 2000 })
    const cards = await page.evaluate(() => document.querySelectorAll('a[href*="/videos/"], [data-video-id]').length)
    res.push({ ...w, cards })
    log(`[videos] ${label} 请求=${JSON.stringify(w.reqs)} 文本变化=${w.textSigChanged} 卡片=${cards}`)
  }
  out.videos = { meta, res }
  await s.browser.close()
}

// ---------- 3) /marketplace 分类 tab 选中态 ----------
{
  const s = await session()
  const { page } = s
  await open(page, '/marketplace', { settle: 3500 })
  const snap = () => page.evaluate(() => {
    const list = [...document.querySelectorAll('[role="tab"],button')].filter((e) => /全部插件|飙升榜|搜索|精选|新上架/.test(e.textContent || ''))
    return list.map((e) => ({ txt: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12), aria: e.getAttribute('aria-selected'), ds: e.getAttribute('data-state'), dataState: e.dataset.state || '', activeCls: /primary|active|bg-/.test(e.className) ? e.className.slice(0, 80) : '' }))
  })
  const before = await snap()
  const cards0 = await page.evaluate(() => document.querySelectorAll('[class*="rounded-xl"]').length)
  const w = await watch(page, async () => {
    const t = page.locator('[role="tab"]:has-text("飙升榜"), button:has-text("飙升榜")').first()
    await t.click({ timeout: 4000 }).catch(() => {})
    return { clicked: (await t.count()) > 0 }
  }, { settle: 2500 })
  const after = await snap()
  const cards1 = await page.evaluate(() => document.querySelectorAll('[class*="rounded-xl"]').length)
  out.marketTabs = { before, after, cards0, cards1, reqs: w.reqs, textSigChanged: w.textSigChanged }
  log('[market] tab 前=' + JSON.stringify(before).slice(0, 200))
  log('[market] tab 后=' + JSON.stringify(after).slice(0, 200), '卡片', cards0, '->', cards1, '请求', JSON.stringify(w.reqs))
  await s.browser.close()
}

// ---------- 4) 已安装页空态「点击直达」按钮 ----------
{
  const s = await session({ auth: true })
  const { page } = s
  await open(page, '/marketplace/installed', { settle: 3000 })
  const b = page.locator('button:has-text("点击直达")').first()
  const found = (await b.count()) > 0
  let w = null
  if (found) {
    w = await watch(page, async () => { await b.click({ timeout: 4000 }).catch(() => {}); return {} }, { settle: 3000 })
  }
  out.emptyStateDirect = { found, ...(w || {}) }
  log('[empty-cta] 命中=' + found, JSON.stringify(w?.reqs || []), '新标签=' + (w?.newTabs ?? 0), '文本变化=' + (w?.textSigChanged ?? 'n/a'))
  await s.browser.close()
}

// ---------- 5) 投稿超长/特殊字符：注入精确判定 ----------
{
  const s = await session()
  const { page } = s
  await open(page, '/submit', { settle: 2500 })
  const urlBox = page.locator('input[placeholder="https://example.com"]').first()
  const nameBox = page.locator('input[placeholder="例如：Cursor 或 Linear"]').first()
  const MARK = 'AUDITMARK9137'
  if (await urlBox.isVisible().catch(() => false)) await urlBox.fill(`https://example.com/${MARK}` + '<svg/onload=alert(1)>')
  if (await nameBox.isVisible().catch(() => false)) await nameBox.fill(`${MARK}名字"><img src=x onerror=alert(1)>`)
  await clickText(page, /提交|立即提交/, { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(3500)
  const probe = await page.evaluate((m) => {
    const html = document.documentElement.outerHTML
    const occurrences = (html.match(new RegExp(m, 'g')) || []).length
    const inInput = [...document.querySelectorAll('input,textarea')].filter((e) => (e.value || '').includes(m)).length
    const badEls = document.querySelectorAll('img[src="x"], svg[onload], [onerror]').length
    const inlineScripts = [...document.querySelectorAll('script:not([src])')]
    const inlineWithMark = inlineScripts.filter((x) => (x.textContent || '').includes(m)).length
    const leakedIntoText = (document.body.innerText || '').includes(m)
    const truncated = { url: [...document.querySelectorAll('input')].map((e) => e.value.length).filter((n) => n > 0).slice(0, 4) }
    return { occurrences, inInput, badEls, inlineScripts: inlineScripts.length, inlineWithMark, leakedIntoText, truncated, note: 'badEls>0 或 inlineWithMark>0 才算真注入；Next.js 本身就有内联脚本，不能用 script 数量判定' }
  }, MARK)
  const txt = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
  out.injectProbe = { probe, pageText: txt, screenshot: 'shots/10-inject.png' }
  await page.screenshot({ path: 'shots/10-inject.png' })
  log('[inject]', JSON.stringify(probe), '文案="' + txt.slice(0, 90) + '"')
  await s.browser.close()
}

// ---------- 6) signin?error=AccessDenied 是否给出可读拒绝原因 ----------
{
  const s = await session()
  const { page } = s
  await open(page, '/auth/signin?error=AccessDenied', { settle: 2500 })
  const info = await page.evaluate(() => {
    const t = (document.body.innerText || '').replace(/\s+/g, ' ')
    return {
      head: t.slice(0, 220),
      hasErrorNode: !!document.querySelector('[class*="destructive"],[role="alert"],[data-role="error"], .text-destructive'),
      errorText: [...document.querySelectorAll('[role="alert"],[class*="destructive"]')].map((e) => e.textContent.trim().slice(0, 60)).join(' | '),
    }
  })
  out.accessDenied = info
  log('[access-denied] 错误节点=' + info.hasErrorNode, JSON.stringify(info.errorText), '首屏="' + info.head.slice(0, 90) + '"')
  await s.browser.close()
}

// ---------- 7) 「刷新」类按钮：看是否真的发请求 ----------
for (const [route, label, auth] of [['/me', '刷新', true], ['/admin/plugins', '刷新', true], ['/admin/plugin-health', '同步快照', true]]) {
  const s = await session({ auth })
  const { page } = s
  await open(page, route, { settle: 3000 })
  const b = page.locator(`button:has-text("${label}")`).first()
  const found = (await b.count()) > 0
  let w = null
  if (found) w = await watch(page, async () => { await b.click({ timeout: 4000 }).catch(() => {}); return {} }, { settle: 3000 })
  out[`refresh:${route}`] = { found, reqs: w?.reqs || [], textSigChanged: w?.textSigChanged, toast: w?.toast }
  log(`[refresh] ${route}[${label}] 命中=${found} 请求=${JSON.stringify(w?.reqs || [])} 文本变化=${w?.textSigChanged}`)
  await s.browser.close()
}

writeFileSync(OUT + '10-focus.json', JSON.stringify({ base: BASE, out }, null, 2))
console.log('\n[saved] 10-focus.json')
