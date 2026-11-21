import { expect, test, type Page } from '@playwright/test'

// P1-1：手机端小猫猫挂件盖住市场搜索框右端（390×844，coarse pointer）。
// 修复在 apps/web-overlay/public/xiaomaomao/xiaomaomao.js：
//   - /marketplace 窄屏进页即自动收起并滑出视口（.xm-parked），滚过搜索行后露出圆标入口
//   - 任何输入聚焦时挂件整体静默（.xm-quiet），失焦恢复
//   - 单次气泡 4.5 秒自动消失，聚焦期间不重出
//   - 猫身常驻收起角标（.xm-mini-close），不点猫也可收起
// 本文件只做行为断言（elementFromPoint 实测命中元素），不用源码文本断言。
// 注意：本机无 Chrome 跑不起来，以 CI E2E 运行结果为准。

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

type Rect = { x: number; y: number; width: number; height: number }

function overlap(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return Math.round(x * y * 100) / 100
}

/** (x, y) 处最顶层元素的标签 / aria-label。 */
async function elAtPoint(page: Page, x: number, y: number) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py) as HTMLElement | null
    if (!el) return null
    return { tag: el.tagName, aria: el.getAttribute('aria-label'), cls: (el.className ?? '').toString().slice(0, 80) }
  }, [x, y])
}

/** (x, y) 的命中元素是否就是 closestSelector 对应的元素本身或其子孙。 */
async function hitIs(page: Page, x: number, y: number, closestSelector: string): Promise<boolean> {
  return page.evaluate(([px, py, sel]) => {
    const el = document.elementFromPoint(px, py) as HTMLElement | null
    return !!el && !!el.closest(sel)
  }, [x, y, closestSelector])
}

async function waitForCat(page: Page) {
  await page.waitForSelector('#xiaomaomao', { timeout: 30_000 })
  // lazyOnload 脚本 + 850ms 入场招呼 + .45s 收起滑动，留足余量
  await page.waitForTimeout(2000)
}

async function scrollToRealBottom(page: Page) {
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior }))
    await page.waitForTimeout(600)
    const done = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4,
    )
    if (done) return true
  }
  return false
}

test('市场页 390px：进页猫自动收起滑出视口，搜索框右端中心命中 input', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/marketplace')
  await page.waitForLoadState('domcontentloaded')
  await waitForCat(page)

  const input = page.getByLabel('搜索插件')
  await expect(input).toBeVisible()
  const search = await input.boundingBox()
  expect(search, '市场搜索框应有包围盒').toBeTruthy()

  // A1-4：猫根节点包围盒与搜索框零重叠（收起后根节点只剩圆标，且已滑出视口）
  const cat = await page.locator('#xiaomaomao').boundingBox()
  expect(cat, '应找到 #xiaomaomao').toBeTruthy()
  expect(overlap(cat!, search!), '猫包围盒与搜索框应零重叠').toBe(0)

  // A1-1：搜索框右端中心（清除 × 出现的位置）命中 input 本身
  const px = search!.x + search!.width - 10
  const py = search!.y + search!.height / 2
  const hit = await elAtPoint(page, px, py)
  expect(hit?.tag, `搜索框右端中心 (${Math.round(px)},${Math.round(py)}) 应命中 INPUT，实际 ${JSON.stringify(hit)}`).toBe('INPUT')
})

test('市场页 390px：输入聚焦时猫静默，清除 × 可点，失焦后恢复', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/marketplace')
  await page.waitForLoadState('domcontentloaded')
  await waitForCat(page)

  const input = page.getByLabel('搜索插件')
  await expect(input).toBeVisible()
  await input.click()
  await input.fill('test')
  await expect(page.getByLabel('清除输入')).toBeVisible()

  // A1-1（有文本态）：清除 × 中心命中清除按钮本身（或其内部 svg）
  const clearBox = await page.getByLabel('清除输入').boundingBox()
  expect(clearBox, '清除按钮应有包围盒').toBeTruthy()
  const okClear = await hitIs(
    page,
    clearBox!.x + clearBox!.width / 2,
    clearBox!.y + clearBox!.height / 2,
    '[aria-label="清除输入"]',
  )
  expect(okClear, '清除 × 中心应命中清除按钮').toBe(true)

  // A1-2（聚焦态）：猫处于静默态，搜索框右端仍命中 input
  await expect(page.locator('#xiaomaomao')).toHaveClass(/xm-quiet/)
  const search = await input.boundingBox()
  // 有文本时清除 × 占住输入框右端：按钮 right-1.5（6px）+ p-0.5 与 14px 的 X，
  // 盒子宽 18px，横向覆盖 [右缘-24, 右缘-6]；固定 width-10 的探查点正落在其内，
  // 命中的是按钮本身而非猫遮挡（3 次重试同一错误即为证，猫的 xm-quiet 断言已过）。
  // 所以探查点改锚在清除按钮左缘以左 10px（= 右缘-34，仍在输入框文本区内），
  // 只验证猫没盖住右端；按钮盒子在断言前重取，免列表重渲染造成布局漂移。
  const clearBoxNow = await page.getByLabel('清除输入').boundingBox()
  expect(clearBoxNow, '清除按钮应仍可见').toBeTruthy()
  const probeX = clearBoxNow!.x - 10
  expect(probeX, '探查点应在输入框内、清除按钮左侧').toBeGreaterThan(search!.x)
  const hit = await elAtPoint(page, probeX, search!.y + search!.height / 2)
  expect(hit?.tag, `聚焦时搜索框右端应命中 INPUT，实际 ${JSON.stringify(hit)}`).toBe('INPUT')

  // 失焦后静默解除（市场页收起态本身保留，猫不回弹到搜索框上）
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await expect(page.locator('#xiaomaomao')).not.toHaveClass(/xm-quiet/, { timeout: 5000 })
})

test('首页 390px：入场招呼气泡 5 秒内消失，之后不重出', async ({ page }) => {
  test.setTimeout(120_000)
  // U-260 前置（2026-11-21）：全新 profile 下猫默认收起（closed: true），850ms
  // 自动招呼被 !xm-closed 门拦住（xiaomaomao.js:3895），气泡 15 秒永不出
  // （CI 同错，本地复现同错）。预置 localStorage closed:false，恢复用例编写
  // 时的前提（进页即展开）；招呼出现/4.5 秒自消/8 秒不重出的断言一字不动。
  // 键与形状与本文件 Q1 用例同款（STORE_KEY = 'navhub.xiaomaomao.v1'）。
  await page.addInitScript(() => {
    window.localStorage.setItem('navhub.xiaomaomao.v1', JSON.stringify({ closed: false }))
  })
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await waitForCat(page)

  // A2-1：等招呼气泡出现后计时，5 秒内必须消失（实现是 4.5 秒定时器，
  // xiaomaomao.js:1552 `setTimeout(hideBubble, 4500)`）。
  // （2026-11-18 :123 选 b：c3001 门控阈值改按单个元素重叠面积占气泡面积
  // >25% 判定——390px 首页三个 44px 悬浮钮各占气泡仅约 12%，不再拦住招呼；
  // 整宽卡片/搜索框等大面积遮挡仍拦。3fc08466 的“永不出现”断言方向已弃，
  // 本用例改回原断言；4.5 秒自动消失全路径自此由本用例覆盖。）
  const bubble = page.locator('#xiaomaomao .xm-bubble')
  await expect(bubble).toHaveClass(/xm-show/, { timeout: 15_000 })
  const seenAt = Date.now()
  await expect(bubble).not.toHaveClass(/xm-show/, { timeout: 6000 })
  expect(Date.now() - seenAt, '单次气泡应自出现起 5 秒内消失').toBeLessThan(5000)

  // A2-2：消失后 8 秒内不得重出。时序算术（T = 挂件初始化时刻；本窗口约
  // T+2s 至 T+10s，waitForCat 已等 2 秒、此处再等 8 秒）：三条可能重出气泡的
  // 路径都落不到窗内——分页面提示在 T+26s（xiaomaomao.js:3027）、闲时 tip
  // 需 idle > 50s（:1759）、切走回访招呼需切走 ≥90s 后切回（:1743）。
  await page.waitForTimeout(8000)
  await expect(bubble).not.toHaveClass(/xm-show/)

  // B2-3（366fd5a3）：招呼气泡消失后，不应把整只猫卸掉——8 秒后挂件本身仍可见。
  // 更强断言（点猫后气泡出现）未加：粗指针下点猫本体只开关控制坞，气泡要
  // 走坞内摸猫钮（.xm-pet-btn → petCat → showBubble），两步路径本机无
  // Chrome 可验，不加未经验证的断言。
  await expect(page.locator('#xiaomaomao')).toBeVisible()
})

test('市场页 390px：滚到底后页脚链接与回到顶部可点', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/marketplace')
  await page.waitForLoadState('domcontentloaded')
  await waitForCat(page)

  const reached = await scrollToRealBottom(page)
  expect(reached, '应能滚到页面底部').toBe(true)
  await page.waitForTimeout(800) // 回到顶部按钮是 scrollY>300 后才现身的 React 状态

  // A3-1（回到顶部）：取按钮顶部附近一点——此处正处猫带的高度（y 718–776），
  // 猫若未收走会盖住它；底栏（y 788–844）不覆盖此点。
  const topButtons = page.locator('button[aria-label="回到顶部"]')
  const topCount = await topButtons.count()
  expect(topCount, '滚到底后至少应有一个回到顶部按钮').toBeGreaterThan(0)
  for (let i = 0; i < topCount; i++) {
    const btn = topButtons.nth(i)
    if (!(await btn.isVisible().catch(() => false))) continue
    const box = await btn.boundingBox()
    if (!box) continue
    const ok = await hitIs(page, box.x + box.width / 2, box.y + 5, 'button[aria-label="回到顶部"]')
    expect(ok, '回到顶部按钮顶部应可点（猫不应盖住）').toBe(true)
  }

  // A3-1（页脚链接）：视口内、底栏（y 788–844）之上的页脚链接逐个断言；
  // 命中须是页脚链接本身（或其子孙），且绝不能是猫挂件（#xiaomaomao 内元素）。
  const links = await page.evaluate(() => {
    const vh = window.innerHeight
    return Array.from(document.querySelectorAll('footer a'))
      .map((a) => {
        const r = a.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: (a.textContent ?? '').trim().slice(0, 20) }
      })
      .filter((b) => b.w > 0 && b.h > 0 && b.y >= 0 && b.y + b.h <= vh && b.y + b.h / 2 < 780)
  })
  expect(links.length, '滚到底后视口内底栏之上应至少有一个页脚链接').toBeGreaterThan(0)
  let directlyHittable = 0
  for (const b of links.slice(0, 6)) {
    const res = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py) as HTMLElement | null
      if (!el) return 'none'
      if (el.closest('#xiaomaomao')) return 'cat'
      const link = el.closest('a')
      return link && link.closest('footer') ? 'footer-link' : 'other'
    }, [b.x + b.w / 2, b.y + b.h / 2])
    expect(res, `页脚链接「${b.text}」中心不应被猫盖住，实际 ${res}`).not.toBe('cat')
    if (res === 'footer-link') directlyHittable += 1
  }
  expect(directlyHittable, '至少一个页脚链接应可直接点到').toBeGreaterThan(0)
})

test('市场页 390px：滚过搜索行露出圆标入口，点圆标可唤回小猫', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/marketplace')
  await page.waitForLoadState('domcontentloaded')
  await waitForCat(page)

  // S-1：滚过搜索行后，收起的圆标应露出来（仍收起态，可唤回）
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: 'instant' as ScrollBehavior }))
  await page.waitForTimeout(600)
  const tab = page.getByLabel('叫出小猫猫')
  await expect(tab).toBeVisible()
  const tabBox = await tab.boundingBox()
  expect(tabBox, '圆标应有包围盒').toBeTruthy()
  expect(tabBox!.x + tabBox!.width, '圆标应回到视口内').toBeLessThanOrEqual(390)

  // 点圆标唤回：猫展开，不再是收起态
  await tab.click()
  await expect(page.locator('#xiaomaomao')).not.toHaveClass(/xm-closed/, { timeout: 5000 })

  // S-3：猫身常驻收起角标不事先点猫也可见可点，点后猫收起
  const miniClose = page.locator('#xiaomaomao .xm-mini-close')
  await expect(miniClose).toBeVisible()
  await miniClose.click()
  await expect(page.locator('#xiaomaomao')).toHaveClass(/xm-closed/, { timeout: 5000 })
})

test('市场页 390px：拖动过的猫收起后整只滑出视口（Q1 返工）', async ({ page }) => {
  test.setTimeout(120_000)
  // 先不预置进页一次，量出搜索行的纵向位置（猫是 fixed 定位，不影响搜索框布局，两次加载位置一致）
  await page.goto('/marketplace')
  await page.waitForLoadState('domcontentloaded')
  await waitForCat(page)
  const input0 = page.getByLabel('搜索插件')
  await expect(input0).toBeVisible()
  const search0 = await input0.boundingBox()
  expect(search0, '市场搜索框应有包围盒').toBeTruthy()
  const searchY = Math.round(search0!.y + search0!.height / 2)

  // 两个拖动位置各一：最左（left:4）与偏右（left:274，在 390 宽下 applySavedPos 的钳制范围内；
  // 钳制上限为 390 − 88 − 4 = 298，274 只是偏右取值而非上限）。
  // localStorage 的值是整个 store 对象，pos 为 {left, top}（STORE_KEY = 'navhub.xiaomaomao.v1'）；
  // 用 evaluate 写（addInitScript 会在两次循环里累积），写完重载，挂件初始化即读到预置位置。
  for (const left of [4, 274]) {
    await page.evaluate(([l, top]) => {
      window.localStorage.setItem('navhub.xiaomaomao.v1', JSON.stringify({ pos: { left: l, top } }))
    }, [left, searchY])
    await page.goto('/marketplace')
    await page.waitForLoadState('domcontentloaded')
    await waitForCat(page)

    const input = page.getByLabel('搜索插件')
    await expect(input).toBeVisible()
    const search = await input.boundingBox()
    expect(search, '市场搜索框应有包围盒').toBeTruthy()

    // Q1：拖动过的猫收起后也须整只滑出视口——根节点左缘应在视口右缘之外，与搜索框零重叠
    const cat = await page.locator('#xiaomaomao').boundingBox()
    expect(cat, '应找到 #xiaomaomao').toBeTruthy()
    expect(cat!.x, `拖动位置 left=${left} 时猫收起后左缘应在视口之外，实际 x=${Math.round(cat!.x)}`).toBeGreaterThanOrEqual(390)
    expect(overlap(cat!, search!), `拖动位置 left=${left} 时猫包围盒与搜索框应零重叠`).toBe(0)

    // 搜索框右端中心命中 input 本身
    const hit = await elAtPoint(page, search!.x + search!.width - 10, search!.y + search!.height / 2)
    expect(hit?.tag, `拖动位置 left=${left} 时搜索框右端应命中 INPUT，实际 ${JSON.stringify(hit)}`).toBe('INPUT')
  }
})

test('市场页 390px：快速下滚回顶（450ms 内）收起位移不算小，猫整只滑出视口', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/marketplace')
  await page.waitForLoadState('domcontentloaded')
  await waitForCat(page)

  // 先滚过搜索行露出圆标（解除收起，transform 由 parkX 向 0 过渡 .45s），
  // 50ms 后立即回顶——收起位移若按过渡中的矩形算会算小，猫留一部分在视口内。
  // 旧实现在此处量到过渡中的 left，终态左缘约 362 < 390；修好后应为 402。
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'instant' as ScrollBehavior }))
  await page.waitForTimeout(50)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }))
  // 等收起滑动走完（.45s + 余量），再断言终态
  await page.waitForTimeout(1500)

  const cat = await page.locator('#xiaomaomao').boundingBox()
  expect(cat, '应找到 #xiaomaomao').toBeTruthy()
  expect(cat!.x, `快滑回顶后猫收起左缘应在视口之外，实际 x=${Math.round(cat!.x)}`).toBeGreaterThanOrEqual(390)

  const input = page.getByLabel('搜索插件')
  await expect(input).toBeVisible()
  const search = await input.boundingBox()
  expect(search, '市场搜索框应有包围盒').toBeTruthy()
  const hit = await elAtPoint(page, search!.x + search!.width - 10, search!.y + search!.height / 2)
  expect(hit?.tag, `快滑回顶后搜索框右端应命中 INPUT，实际 ${JSON.stringify(hit)}`).toBe('INPUT')
})
