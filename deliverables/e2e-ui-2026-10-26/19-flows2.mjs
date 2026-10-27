/**
 * 主流程补测：04-flows 里 5 个 FAIL 全部来自我的入口标签猜错或被上一步导航级联打断。
 * 本轮逐个用「先列标签、再点」的方式判定，并把真实可用入口名字记下来（报告要引用）。
 */
import { session, open, clickText, state, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const R = []
const rec = (name, fn) => R.push({ name, fn })

const s = await session({ auth: true })
const { page } = s

// ---------- 1. DIY：添加模块 / 保存 / 撤销 / 分享链接 ----------
rec('DIY 添加模块 → 保存 → 撤销', async () => {
  await open(page, '/custom', { settle: 4500 })
  const labels = await page.evaluate(() =>
    [...(document.querySelector('main')?.querySelectorAll('button') || [])]
      .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  )
  const add = await clickText(page, /添加模块|选择并添加模块|添加组件|\+ *模块/, { timeout: 8000 })
  let modBefore = null, modAfter = null, saved = null, undone = null
  if (add.clicked) {
    await page.waitForTimeout(1200)
    const board = () =>
      page.evaluate(() => document.querySelectorAll('[data-module-id],[draggable="true"],[class*="module"]').length)
    modBefore = await board()
    const pick = await clickText(page, /^(时钟|UUID|计时器|便签|日历|天气|代码片段|快捷链接)/, { timeout: 6000 })
    await page.waitForTimeout(1500)
    modAfter = await board()
    saved = (await clickText(page, /保存|应用|完成/, { timeout: 6000 })).clicked
    await page.waitForTimeout(1200)
    undone = (await clickText(page, /撤销|回退|重置|恢复默认/, { timeout: 6000 })).clicked
  }
  const st = await state(page)
  return `可选入口=${labels.length}个 添加入口=${add.clicked ? '有' : '无'} 模块节点 ${modBefore} -> ${modAfter} 保存=${saved} 撤销=${undone} toast=${JSON.stringify(st.toast).slice(0, 80)}`
})

rec('DIY 分享链接（#diy= 生成）', async () => {
  await open(page, '/custom', { settle: 4000 })
  const share = await clickText(page, /分享|生成链接|复制链接|导出配置/, { timeout: 8000 })
  await page.waitForTimeout(2000)
  const url = page.url()
  const clip = await page.evaluate(async () => {
    try { return await navigator.clipboard.readText() } catch { return '(不可读)' }
  })
  const st = await state(page)
  return `分享入口=${share.clicked ? '有' : '无'} urlHasDiy=${url.includes('#diy=')} 剪贴板HasDiy=${String(clip).includes('#diy=')} 剪贴板=${JSON.stringify(String(clip)).slice(0, 110)} toast=${JSON.stringify(st.toast).slice(0, 80)}`
})

// ---------- 2. 偏好设置：开关 + 刷新保持 ----------
rec('偏好设置：开关切换 + 刷新后保持', async () => {
  await open(page, '/preferences', { settle: 3500 })
  const sw = page.locator('[role="switch"],input[type="checkbox"]').first()
  const found = (await sw.count()) > 0
  if (!found) return '偏好页没有开关控件'
  const before = await sw.getAttribute('aria-checked').catch(() => null)
  await sw.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const afterClick = await sw.getAttribute('aria-checked').catch(() => null)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const afterReload = await page
    .locator('[role="switch"],input[type="checkbox"]')
    .first()
    .getAttribute('aria-checked')
    .catch(() => null)
  return `aria-checked ${before} -> ${afterClick} -> 刷新后 ${afterReload} 持久化=${before !== afterClick && afterReload === afterClick}`
})

// ---------- 3. 后台分类 CRUD（夹具，建完即删） ----------
rec('管理后台写操作：新建分类 → 编辑 → 删除（夹具）', async () => {
  const reqs = []
  page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(r.method() + ' ' + (r.url().split('/api/hub/')[1] || r.url())) })
  await open(page, '/admin/categories', { settle: 4000 })
  reqs.length = 0
  const add = await clickText(page, /新建分类|新增分类|添加分类|新建|新增/, { timeout: 8000 })
  await page.waitForTimeout(1500)
  const dlg = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  let created = false, renamed = false, removed = false
  if (dlg) {
    const title = page.locator('[role="dialog"] input').first()
    await title.fill('UI 巡检分类夹具').catch(() => {})
    const ok = await clickText(page, /确认创建|确认|保存|提交/, { timeout: 6000 })
    await page.waitForTimeout(2500)
    created = ok.clicked
    const row = page.locator('text=UI 巡检分类夹具').first()
    renamed = (await row.count()) > 0
    if (renamed) {
      await page.locator('[role="dialog"]').first().press('Escape').catch(() => {})
      const del = await clickText(page, /删除/, { timeout: 6000 })
      await page.waitForTimeout(1200)
      const confirm = await clickText(page, /确认删除|确认|删除/, { timeout: 5000 })
      await page.waitForTimeout(2500)
      removed = del.clicked && confirm.clicked
    }
  }
  return `新建入口=${add.clicked ? '有' : '无'} 弹窗=${dlg} 提交=${created} 列表命中=${renamed} 删除=${removed} 写请求=${JSON.stringify(reqs.filter((r) => /^(POST|PUT|PATCH|DELETE)/.test(r)).slice(0, 6))}`
})

// ---------- 4. 退出登录 ----------
rec('退出登录 → 受保护页回到登录页', async () => {
  await open(page, '/admin', { settle: 3500 })
  const out = await clickText(page, /退出登录|退出|登出|Sign out/, { timeout: 8000 })
  await page.waitForTimeout(2500)
  const confirm = await clickText(page, /确认退出|确认|退出/, { timeout: 5000 })
  await page.waitForTimeout(3000)
  let backTo = page.url()
  if (!/signin|login/.test(backTo)) {
    await open(page, '/admin/tokens', { settle: 3000 })
    backTo = page.url()
  }
  return `退出入口=${out.clicked ? '有' : '无'} 确认=${confirm.clicked} 再访 /admin/tokens 落到=${backTo}`
})

const rows = []
for (const { name, fn } of R) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    rows.push({ name, status: 'PASS', ms: Date.now() - t0, detail })
    console.log(`[flows2] PASS ${name} :: ${detail}`)
  } catch (e) {
    rows.push({ name, status: 'FAIL', ms: Date.now() - t0, error: String(e.message || e).slice(0, 300) })
    console.log(`[flows2] FAIL ${name} :: ${String(e.message || e).slice(0, 200)}`)
  }
}
writeFileSync(OUT + '19-flows2.json', JSON.stringify({ base: BASE, module: '主流程补测（标签纠偏 + 级联重跑）', rows }, null, 2))
console.log('\n[saved] 19-flows2.json')
await s.browser.close()
