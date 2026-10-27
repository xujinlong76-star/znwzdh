/**
 * 收尾取证（5 个仍未定论的点，全部按源码真实入口来）：
 *  a. 首页 DIY 工具栏「导出 / 导入配置 JSON」→ 免登分享链接（#diy=）
 *  b. /preferences 唯一复选框为什么不持久化（本地键 / 网络请求）
 *  c. /admin/categories「新建类目」为何恒 disabled
 *  d. 模块库弹窗 Esc 关不掉是否属实（并找可用关闭路径）
 *  e. 退出登录后受保护页是否回弹（以及 BFF 是否还在替匿名请求注入管理员凭据）
 */
import { session, open, state, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const out = {}
const s = await session({ auth: true })
const { page, ctx } = s

const byTitle = async (re) => {
  const els = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => b.getAttribute('title') || '').filter(Boolean),
  )
  return els.filter((t) => re.test(t))
}

// ---- a. 首页 DIY 分享链接 ----
await open(page, '/', { settle: 5500 })
const diyTitles = await byTitle(/导出|导入配置|重置排版|备份/)
out.homeDiyToolbarTitles = diyTitles
if (diyTitles.length) {
  const reqs = []
  page.on('response', (r) => { if (r.url().includes('/api/')) reqs.push(r.status() + ' ' + (r.url().split('/api/hub/')[1] || r.url().split('/api/')[1])) })
  const clicked = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '') === t)
    if (el) { el.click(); return true }
    return false
  }, diyTitles[0])
  await page.waitForTimeout(2200)
  const dlgVisible = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  const dlgTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] button,[role="dialog"] [role="tab"]')].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14),
  )
  const share = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="dialog"] button')].find((b) => /免登专属分享链接|生成分享/.test(b.textContent || ''))
    if (el) { el.click(); return (el.textContent || '').trim().slice(0, 40) }
    return null
  })
  await page.waitForTimeout(2000)
  const st = await state(page)
  out.shareLink = {
    entryClicked: clicked,
    dialog: dlgVisible,
    dialogButtons: dlgTabs,
    shareButton: share,
    urlHasDiy: page.url().includes('#diy='),
    toast: st.toast.slice(0, 3),
    reqs: reqs.slice(0, 8),
  }
  console.log('[a] 首页 DIY 备份弹窗 ' + JSON.stringify(out.shareLink))
} else {
  console.log('[a] 首页 DIY 工具栏未渲染（标题里没有导出/备份入口）titles=' + JSON.stringify(diyTitles))
}

// ---- b. 偏好设置持久化 ----
await open(page, '/preferences', { settle: 4200 })
const prefBefore = await page.evaluate(() => {
  const box = document.querySelector('input[type="checkbox"]')
  return {
    label: box?.closest('label')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) ?? box?.parentElement?.innerText?.replace(/\s+/g, ' ').slice(0, 60),
    checked: box ? box.checked : null,
    disabled: box ? box.disabled : null,
    lsKeys: Object.keys(localStorage).filter((k) => /pref|setting|theme|option/i.test(k)),
    lsSnapshot: Object.entries(localStorage).filter(([k]) => /pref|setting|theme|option/i.test(k)).map(([k, v]) => k + ':' + String(v).length),
  }
})
const prefReq = []
page.on('response', (r) => { if (r.url().includes('/api/') && !r.url().includes('/_next/')) prefReq.push(r.request().method() + ' ' + (r.url().split('/api/')[1] || '') + ' ' + r.status()) })
const box = page.locator('input[type="checkbox"]').first()
await box.click({ timeout: 5000 }).catch(() => {})
await page.waitForTimeout(1600)
const midSnap = await page.evaluate(() =>
  Object.entries(localStorage).filter(([k]) => /pref|setting|theme|option/i.test(k)).map(([k, v]) => k + ':' + String(v).length),
)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const afterReload = await page.evaluate(() => {
  const b = document.querySelector('input[type="checkbox"]')
  return {
    checked: b ? b.checked : null,
    lsSnapshot: Object.entries(localStorage).filter(([k]) => /pref|setting|theme|option/i.test(k)).map(([k, v]) => k + ':' + String(v).length),
  }
})
out.preferences = { prefBefore, clickedTo: !prefBefore.checked, midSnap, afterReload, reqs: prefReq.slice(0, 10) }
console.log('[b] 偏好 ' + JSON.stringify(out.preferences))
await box.click({ timeout: 4000 }).catch(() => {})

// ---- c. 新建类目 disabled ----
await open(page, '/admin/categories', { settle: 5200 })
out.newCategory = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('main button')].find((b) => /新建类目/.test(b.textContent || ''))
  const treeNodes = [...document.querySelectorAll('main [role="treeitem"],main [role="button"],main li[aria-selected],main [data-node-id],main [data-sonner]')]
  const clickableRows = [...document.querySelectorAll('main div,main li')]
    .filter((e) => (e.textContent || '').trim().length > 1 && (e.textContent || '').trim().length < 24 && e.onclick !== undefined && e.getAttribute('tabindex') !== null)
    .slice(0, 5)
    .map((e) => e.tagName + '「' + (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16) + '」')
  return {
    found: !!btn,
    disabled: btn ? btn.disabled : null,
    title: btn?.getAttribute('title') ?? null,
    aria: btn?.getAttribute('aria-label') ?? null,
    parentText: btn ? (btn.closest('div.flex')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160) : null,
    treeRoleNodes: treeNodes.length,
    clickableRows,
    hint: (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 260),
  }
})
console.log('[c] 新建类目 ' + JSON.stringify(out.newCategory).slice(0, 700))

// ---- d. 模块库弹窗 Esc ----
await open(page, '/custom', { settle: 5000 })
await page.evaluate(() => {
  const el = [...document.querySelectorAll('main button')].find((b) => /自定义排版/.test(b.textContent || ''))
  if (el) el.click()
})
await page.waitForTimeout(2000)
await page.evaluate(() => {
  const el = [...document.querySelectorAll('main button')].find((b) => /添加模块/.test(b.textContent || ''))
  if (el) el.click()
})
await page.waitForTimeout(1600)
const dlgState = async () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => (d.getAttribute('data-state') || (d.offsetWidth > 0 ? 'visible' : 'hidden')) + ':' + (d.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 18)))
const d0 = await dlgState()
await page.keyboard.press('Escape')
await page.waitForTimeout(1200)
const dEsc = await dlgState()
const closeBtns = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"] button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14)).filter(Boolean).slice(-6),
)
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="dialog"] button')].find((b) => /关闭|取消|完成|收起/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))
  if (el) el.click()
})
await page.waitForTimeout(1200)
const dBtn = await dlgState()
out.moduleDialog = { open: d0, afterEscape: dEsc, afterCloseBtn: dBtn, closeButtons: closeBtns }
console.log('[d] 模块库弹窗 ' + JSON.stringify(out.moduleDialog))

// ---- e. 退出登录后受保护面 ----
const anon = await session({ auth: false })
const a = anon.page
await a.goto(BASE + '/admin/tokens', { waitUntil: 'domcontentloaded' }).catch(() => {})
await a.waitForTimeout(3500)
const tok = await a.evaluate(() => ({
  url: location.pathname,
  h1: [...document.querySelectorAll('h1,h2')].map((h) => h.textContent.trim()).slice(0, 3),
  text: (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
}))
const hubStats = await a.evaluate(async () => {
  const r = await fetch('/api/hub/api/tokens', { headers: { accept: 'application/json' } })
  return { status: r.status, body: (await r.text()).slice(0, 120) }
})
out.anonProtected = { adminTokens: tok, hubTokensViaProxy: hubStats }
console.log('[e] 匿名访受保护页 ' + JSON.stringify(out.anonProtected))
await anon.browser.close()

writeFileSync(OUT + '22-focus2.json', JSON.stringify({ base: BASE, out }, null, 2))
console.log('\n[saved] 22-focus2.json')
await s.browser.close()
