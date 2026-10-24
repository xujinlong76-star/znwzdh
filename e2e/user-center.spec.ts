import { test, expect } from '@playwright/test'

/**
 * 用户中心三态（N6）。
 *
 * 覆盖 /me、/me/history、/me/data 三条此前零 E2E 的页面：
 *  - 匿名态：不谎称"你是匿名"以外的任何事实，给出登录入口；
 *  - 降级态：把接口打挂后必须显示「暂时取不到 + 重试」，而不是「没有记录」——
 *    后者会让用户以为历史被清空，这是本套件真正要守的东西；
 *  - 数据页：两个导出入口 + DELETE 二次确认按钮的禁用态。
 *
 * 不做登录态：仓库没有测试账号体系，那需要单独的基础设施（见 Non-goals）。
 * 三态用「网络拦截 + 空 localStorage」构造，不依赖种子数据。
 */
test.describe('用户中心：三态', () => {
  // 不在这里 clear()：Playwright 每个用例都是独立 context，localStorage 天然是空的；
  // 而 addInitScript 在**每次导航**（含 reload）都会跑，在这里清会把「刷新后仍在」
  // 这类持久化断言一起清掉——本地收藏夹用例正是因此假红过。
  test.beforeEach(async () => {})

  test('/me 匿名态：说明身份事实并给登录入口', async ({ page }) => {
    await page.goto('/me')
    await expect(page.getByRole('heading', { name: '用户中心' })).toBeVisible()
    await expect(page.getByText('当前是匿名身份')).toBeVisible()
    await expect(page.getByRole('link', { name: '登录 / 创建账号' })).toHaveAttribute(
      'href',
      '/auth/signin?callbackUrl=/me',
    )
    // 不该出现的：错误态文案（那意味着把故障渲染成了事实）
    await expect(page.getByText('用户中心加载失败')).toHaveCount(0)
  })

  test('/me 降级态：会话探测失败显示 error 而不是 anonymous', async ({ page }) => {
    await page.route('**/api/auth/session', (route) => route.fulfill({ status: 503, body: '{}' }))
    await page.goto('/me')
    await expect(page.getByText('用户中心加载失败')).toBeVisible()
    await expect(page.getByText('登录状态暂时无法确认，请稍后重试')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    // 关键断言：故障不能被渲染成「你是匿名」
    await expect(page.getByText('当前是匿名身份')).toHaveCount(0)
  })

  test('/me/history 降级态：取数失败不说成「没有记录」', async ({ page }) => {
    // 注意 URL 形态：`hubUrl()` 会剥掉前导 /api，真实路径是 /api/hub/search-history
    await page.route('**/search-history**', (route) => route.fulfill({ status: 503, body: '{}' }))
    await page.goto('/me/history')
    await expect(page.getByText('历史记录暂时取不到')).toBeVisible()
    await expect(page.getByText('这不代表历史被清空')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    // 统一状态组件：错误态必须以 alert 地标暴露给读屏
    await expect(page.getByRole('alert').filter({ hasText: '历史记录暂时取不到' })).toBeVisible()
    // 空态文案只能在「确实成功且为空」时出现
    await expect(page.getByText('还没有搜索记录')).toHaveCount(0)
  })

  test('/me/history 空态：匿名且真的没有历史时给出引导', async ({ page }) => {
    await page.goto('/me/history')
    await expect(page.getByText('还没有搜索记录')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0)
  })

  test('/me/data 匿名态：需要登录，两个导出入口不出现', async ({ page }) => {
    await page.goto('/me/data')
    await expect(page.getByText('需要登录后管理云端数据')).toBeVisible()
    await expect(page.getByRole('button', { name: '下载 JSON' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /导出浏览器书签/ })).toHaveCount(0)
    // 不可逆操作不能在匿名态解锁
    await expect(page.getByRole('button', { name: '永久删除' })).toHaveCount(0)
  })

  test('/me/data 降级态：登录态探测失败不落 anonymous', async ({ page }) => {
    await page.route('**/api/auth/session', (route) => route.fulfill({ status: 500, body: '{}' }))
    await page.goto('/me/data')
    await expect(page.getByText('登录状态暂时无法确认')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '登录状态暂时无法确认' })).toBeVisible()
    await expect(page.getByText('需要登录后管理云端数据')).toHaveCount(0)
  })
  test('/me/settings 匿名态：本机设置可编辑，说明登录后同步', async ({ page }) => {
    await page.goto('/me/settings')
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
    await expect(page.getByText('当前为本机匿名身份')).toBeVisible()
    await expect(page.getByLabel('默认搜索引擎')).toBeVisible()
    // 匿名态不是故障：不应出现错误重试块
    await expect(page.getByText('设置暂时取不到')).toHaveCount(0)
  })

  test('/me/account 匿名态：给登录入口且不渲染资料表单', async ({ page }) => {
    await page.goto('/me/account')
    await expect(page.getByRole('heading', { name: '账号与身份' })).toBeVisible()
    await expect(page.getByText('当前是匿名身份')).toBeVisible()
    // callbackUrl 的百分号编码形式不是契约：按 URL 语义断言解码后的回跳地址
    const signinHref = await page.getByRole('link', { name: '登录 / 创建账号' }).getAttribute('href')
    expect(signinHref && new URL(signinHref, 'http://localhost').searchParams.get('callbackUrl')).toBe(
      '/me/account',
    )
    await expect(page.getByRole('button', { name: '编辑资料' })).toHaveCount(0)
  })

  test('/me/account 降级态：会话探测失败显示可重试错误', async ({ page }) => {
    await page.route('**/api/auth/session', (route) => route.fulfill({ status: 503, body: '{}' }))
    await page.goto('/me/account')
    await expect(page.getByText('账号信息暂时取不到')).toBeVisible()
    await expect(page.getByText('登录状态暂时无法确认，请稍后重试')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '账号信息暂时取不到' })).toBeVisible()
  })

  test('/me/plugins 匿名态：展示入口并说明计数为 0 的原因', async ({ page }) => {
    await page.goto('/me/plugins')
    await expect(page.getByRole('heading', { name: '插件中心' })).toBeVisible()
    await expect(page.getByRole('link', { name: /已安装插件/ })).toHaveAttribute(
      'href',
      '/marketplace/installed',
    )
    await expect(page.getByText('当前是匿名身份')).toBeVisible()
  })

  test('/me/plugins 计数失败：落错误态而不是渲染成 0', async ({ page }) => {
    // 伪造登录态，再把 /api/me 打挂：插件页必须报错并可重试
    await page.route('**/api/auth/session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ user: { id: 'e2e-user' } }),
      }),
    )
    await page.route('**/api/me', (route) => route.fulfill({ status: 503, body: '{}' }))
    await page.goto('/me/plugins')
    await expect(page.getByText('插件数据暂时取不到')).toBeVisible()
    await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: '插件数据暂时取不到' })).toBeVisible()
  })

  test('/favorites 匿名态：可以建本地收藏夹并持久化（P2）', async ({ page }) => {
    // 先塞一条本地收藏：收藏夹面板只在有收藏时出现（没有收藏时不需要分组）
    // 只播种、不清空：addInitScript 在每次导航（含 reload）都会跑，
    // 若在里面 clear() 就会把刚建好的分组一起清掉，测的就不是持久化了。
    await page.addInitScript(() => {
      if (window.localStorage.getItem('navhub.favorites.v1')) return
      window.localStorage.setItem(
        'navhub.favorites.v1',
        JSON.stringify([
          { siteId: 'e2e-local-1', title: 'E2E 站点', href: 'https://e2e.example.com', createdAt: Date.now() },
        ]),
      )
    })
    await page.goto('/favorites')

    // 匿名态必须能建分组——此前这一整块面板不渲染，"无需登录"名不副实
    const nameInput = page.getByLabel('新建收藏夹名称')
    await expect(nameInput).toBeVisible()
    await nameInput.fill('本地分组')
    await page.getByRole('button', { name: '创建' }).click()
    await expect(page.getByRole('button', { name: /本地分组/ })).toBeVisible()
    // 能力边界要说清楚：本地夹子仅存本机
    await expect(page.getByText('本地收藏夹仅存本机；登录后按名称合并到云端')).toBeVisible()

    // 持久化：刷新后分组仍在（独立键，不与收藏本体混存）
    await page.reload()
    await expect(page.getByRole('button', { name: /本地分组/ })).toBeVisible()
  })

  test('/favorites 筛选：无命中时说明收藏还在，清空后恢复', async ({ page }) => {
    // 只播种、不清空：addInitScript 每次导航都会跑，清空会把刚播种的收藏一起清掉。
    await page.addInitScript(() => {
      if (window.localStorage.getItem('navhub.favorites.v1')) return
      window.localStorage.setItem(
        'navhub.favorites.v1',
        JSON.stringify([
          {
            siteId: 'e2e-filter-1',
            title: 'E2E 筛选站点',
            href: 'https://filter.example.com',
            createdAt: Date.now(),
          },
        ]),
      )
    })
    await page.goto('/favorites')

    const search = page.getByLabel('筛选收藏')
    await expect(search).toBeVisible()
    await expect(page.getByText('E2E 筛选站点').first()).toBeVisible()

    await search.fill('zzz-no-such-keyword')
    // 两种「空」必须分开说：这里是「筛选没命中」，不是「收藏为空」
    await expect(page.getByText(/没有收藏匹配「zzz-no-such-keyword」/)).toBeVisible()
    await expect(page.getByText(/收藏并没有丢：共 1 个都还在本机/)).toBeVisible()
    await expect(page.getByText('E2E 筛选站点')).toHaveCount(0)

    await search.fill('')
    await expect(page.getByText('E2E 筛选站点').first()).toBeVisible()
  })
})
