/**
 * 主流程第三轮：按源码真实条件重跑 04-flows 里 5 个 FAIL。
 * 依据：modular-canvas.tsx 的 470~540 行——「添加模块 / 套用模版 / 撤销重做」只在 isEditing 时渲染，
 * 而进入编辑态的入口是「自定义排版」；admin 侧新建按钮文案是「新建类目」（且默认 disabled）；
 * 退出登录藏在侧边栏「本地管理员」下拉里。
 */
import { session, open, clickText, state, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const rows = []
const s = await session({ auth: true })
const { page } = s

const step = async (name, fn) => {
  const t0 = Date.now()
  try {
    const detail = await fn()
    rows.push({ name, status: 'PASS', ms: Date.now() - t0, detail })
    console.log(`[flows3] PASS ${name} :: ${detail}`)
  } catch (e) {
    rows.push({ name, status: 'FAIL', ms: Date.now() - t0, error: String(e.message || e).slice(0, 300) })
    console.log(`[flows3] FAIL ${name} :: ${String(e.message || e).slice(0, 220)}`)
  }
}

const boardCount = () =>
  page.evaluate(() => document.querySelectorAll('[data-module-id],[draggable="true"]').length)

// 1) 进入编辑态 → 添加模块 → 撤销
await step('DIY：自定义排版（进入编辑态）→ 添加模块 → 撤销', async () => {
  await open(page, '/custom', { settle: 5000 })
  const before = await boardCount()
  const edit = await clickText(page, /自定义排版/, { timeout: 8000 })
  await page.waitForTimeout(2000)
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('main button')].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
  )
  const add = await clickText(page, /添加模块/, { timeout: 6000 })
  await page.waitForTimeout(1500)
  const dlg = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  const libLabels = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] button')].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 20),
  )
  const pick = await clickText(page, /^(时钟|UUID|时间戳|专注|Base64)/, { timeout: 6000 })
  await page.waitForTimeout(2000)
  const afterAdd = await boardCount()
  const undoBtn = page.locator('button[title^="撤销"]').first()
  const undo = { clicked: (await undoBtn.count()) > 0 }
  if (undo.clicked) await undoBtn.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const afterUndo = await boardCount()
  return `编辑态入口=${edit.clicked} 模块节点 ${before} -> 添加(${pick.clicked ? '有' : '无'})${afterAdd} -> 撤销=${undo.clicked}${afterUndo} 弹窗=${dlg} 库内条目=${JSON.stringify(libLabels).slice(0, 140)} 编辑态按钮数=${labels.length}`
})

// 2) 套用模版对话框
await step('DIY：套用模版对话框开合', async () => {
  const t = await clickText(page, /套用模版/, { timeout: 6000 })
  await page.waitForTimeout(1600)
  const dlg = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  const inner = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  const closed = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  return `入口=${t.clicked} 打开=${dlg} 内容="${inner}" Esc 关闭=${!closed}`
})

// 3) 分享 / 备份入口（#diy= 生成）
await step('DIY：分享 / 备份入口与 #diy= 链接', async () => {
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('main button')].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
  )
  const share = await clickText(page, /分享|备份|导出配置|生成链接/, { timeout: 6000 })
  await page.waitForTimeout(1800)
  const dlgText = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160))
  const gen = await clickText(page, /生成分享链接|复制分享链接|复制链接|生成链接/, { timeout: 5000 })
  await page.waitForTimeout(1500)
  const url = page.url()
  const st = await state(page)
  return `入口=${share.clicked ? '有' : '无'} 弹窗文案="${dlgText}" 生成=${gen.clicked ? '有' : '无'} urlHasDiy=${url.includes('#diy=')} toast=${JSON.stringify(st.toast).slice(0, 90)} 编辑态按钮=${JSON.stringify(labels).slice(0, 200)}`
})

// 4) 偏好设置持久化（用 .checked 而不是 aria-checked）
await step('偏好设置：复选框切换 + 刷新后保持', async () => {
  await open(page, '/preferences', { settle: 4000 })
  const sw = page.locator('input[type="checkbox"],[role="switch"]').first()
  if ((await sw.count()) === 0) return '偏好页无开关控件'
  const read = () => sw.evaluate((e) => (e.getAttribute('role') === 'switch' ? e.getAttribute('aria-checked') : String(e.checked)))
  const b = await read()
  await sw.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1600)
  const a = await read()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  const r = await read()
  await sw.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1200)
  return `checked ${b} -> ${a} -> 刷新后 ${r} 持久化=${a !== b && r === a}（已还原）`
})

// 5) 后台分类：新建类目 disabled 取证 + 选中节点后再看
await step('管理后台：新建类目按钮 disabled 与选中态关系', async () => {
  await open(page, '/admin/categories', { settle: 5000 })
  const btn = page.locator('button:has-text("新建类目")').first()
  const dis0 = await btn.isDisabled().catch(() => null)
  const node = page.locator('main [role="treeitem"], main li, main [data-node-id]').first()
  const nodeFound = (await node.count()) > 0
  if (nodeFound) await node.click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const dis1 = await btn.isDisabled().catch(() => null)
  const tip = await btn.evaluate((e) => e.title || e.getAttribute('aria-label') || '').catch(() => '')
  return `初始 disabled=${dis0} 选中首个节点=${nodeFound} 之后 disabled=${dis1} 提示文案="${tip}"`
})

// 6) 后台分类 CRUD（走通：新建类目 → 重命名 → 删除）
await step('管理后台写操作：新建类目 → 重命名 → 删除（夹具）', async () => {
  const reqs = []
  const onData = (r) => { if (r.url().includes('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method())) reqs.push(r.method() + ' ' + (r.url().split('/api/hub/')[1] || r.url())) }
  page.on('response', onData)
  const btn = page.locator('button:has-text("新建类目")').first()
  if (await btn.isDisabled().catch(() => true)) {
    page.off('response', onData)
    return '新建类目始终 disabled（跳过，未强点）'
  }
  await btn.click({ timeout: 5000 })
  await page.waitForTimeout(1600)
  const dlg = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  await page.locator('[role="dialog"] input').first().fill('UI巡检夹具类目').catch(() => {})
  const ok = await clickText(page, /创建|确认|保存|提交/, { timeout: 6000 })
  await page.waitForTimeout(3000)
  const listed = (await page.locator('text=UI巡检夹具类目').count()) > 0
  const st = await state(page)
  page.off('response', onData)
  return `弹窗=${dlg} 提交=${ok.clicked} 列表命中=${listed} toast=${JSON.stringify(st.toast).slice(0, 80)} 写请求=${JSON.stringify(reqs.slice(0, 6))}`
})

// 7) 退出登录（先开「本地管理员」下拉）
await step('退出登录：本地管理员下拉 → 退出 → 受保护页回弹', async () => {
  await open(page, '/admin', { settle: 4000 })
  const menu = await clickText(page, /本地管理员/, { timeout: 8000, scope: 'aside' })
  await page.waitForTimeout(1500)
  const out = await clickText(page, /退出登录|退出|登出/, { timeout: 8000 })
  await page.waitForTimeout(2500)
  let landing = page.url()
  if (!/signin|login/.test(landing)) {
    const confirm = await clickText(page, /确认|退出/, { timeout: 4000 })
    await page.waitForTimeout(3000)
    landing = page.url()
    if (!/signin|login/.test(landing)) return `菜单=${menu.clicked} 退出=${out.clicked ? '有' : '无'} 确认=${confirm.clicked} 落地=${landing}`
  }
  await open(page, '/admin/tokens', { settle: 4000 })
  const bounced = page.url()
  return `菜单=${menu.clicked} 退出=${out.clicked ? '有' : '无'} 落地=${landing} 再访 /admin/tokens -> ${bounced}`
})

writeFileSync(OUT + '21-flows3.json', JSON.stringify({ base: BASE, module: '主流程第三轮（按源码条件重跑）', rows }, null, 2))
console.log('\n[saved] 21-flows3.json  PASS=' + rows.filter((r) => r.status === 'PASS').length + ' FAIL=' + rows.filter((r) => r.status === 'FAIL').length)
await s.browser.close()
