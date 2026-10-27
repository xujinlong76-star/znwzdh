/**
 * /admin/categories 的「新建类目」按钮：disabled 到底是不是「名称未填」的正常护栏？
 * 填名 → 看是否解禁 → 走一遍 新建 → 重命名 → 删除（夹具，当场清理）。
 */
import { session, open, state, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const s = await session({ auth: true })
const { page } = s
const reqs = []
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.request().method())) {
    reqs.push(r.request().method() + ' ' + (u.split('/api/hub/')[1] || u.split('/api/')[1] || u) + ' -> ' + r.status())
  }
})

await open(page, '/admin/categories', { settle: 5200 })
const btn = page.locator('main button:has-text("新建类目")').first()
const name = page.locator('main input').first()
const rows = []
const snap = async (tag) => {
  const disabled = await btn.isDisabled().catch(() => null)
  rows.push({ tag, disabled })
  console.log(`[cat] ${tag} 新建类目 disabled=${disabled}`)
  return disabled
}
await snap('空名称')
await name.fill('巡检夹具乙').catch((e) => console.log('  填名失败: ' + e.message.slice(0, 60)))
await page.waitForTimeout(1200)
const d2 = await snap('填入名称后')
let created = null
if (d2 === false) {
  await btn.click({ timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const st = await state(page)
  created = { listed: (await page.locator('text=巡检夹具乙').count()) > 0, toast: st.toast.slice(0, 3) }
  console.log('[cat] 提交后 ' + JSON.stringify(created))
  const renameClicked = await page.evaluate(() => {
    const leaf = (text) =>
      [...document.querySelectorAll('main div,main li')].find(
        (e) =>
          (e.textContent || '').includes(text) &&
          e.querySelectorAll('button').length <= 8 &&
          [...e.querySelectorAll('button')].some((b) => /重命名|删除/.test(b.textContent || '')),
      )
    const node = leaf('巡检夹具乙')
    if (!node) return 'node-not-found'
    const b = [...node.querySelectorAll('button')].find((x) => /重命名/.test(x.textContent || ''))
    if (!b) return 'rename-absent'
    b.click()
    return 'rename-clicked'
  })
  await page.waitForTimeout(1600)
  const dlgVisible = await page.locator('[role="dialog"]').last().isVisible().catch(() => false)
  rows.push({ tag: '重命名', renameClicked, dialog: dlgVisible })
  console.log('[cat] 重命名 ' + renameClicked + ' 弹窗 visible=' + dlgVisible)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)

  const delResult = await page.evaluate(() => {
    const leaf = (text) =>
      [...document.querySelectorAll('main div,main li')].find(
        (e) =>
          (e.textContent || '').includes(text) &&
          e.querySelectorAll('button').length <= 8 &&
          [...e.querySelectorAll('button')].some((b) => /删除/.test(b.textContent || '')),
      )
    const node = leaf('巡检夹具乙')
    if (!node) return 'node-not-found'
    const b = [...node.querySelectorAll('button')].find((x) => /删除/.test(x.textContent || ''))
    if (!b) return 'delete-absent'
    b.click()
    return 'delete-clicked'
  })
  await page.waitForTimeout(1600)
  const confirm = await page
    .locator('[role="alertdialog"] button, [role="dialog"] button')
    .filter({ hasText: /确认|删除/ })
    .first()
    .click({ timeout: 4000 })
    .then(() => true)
    .catch(() => false)
  await page.waitForTimeout(2500)
  const gone = (await page.locator('text=巡检夹具乙').count()) === 0
  rows.push({ tag: '删除', delResult, confirmClicked: confirm, gone })
  console.log('[cat] 删除 ' + delResult + ' 确认=' + confirm + ' 已消失=' + gone)
}
const result = { base: BASE, rows, created, reqs: reqs.slice(0, 12) }
writeFileSync(OUT + '23-cat.json', JSON.stringify(result, null, 2))
console.log('\n写请求: ' + JSON.stringify(result.reqs))
console.log('[saved] 23-cat.json')
await s.browser.close()
