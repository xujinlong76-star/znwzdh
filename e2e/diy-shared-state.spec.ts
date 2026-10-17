import { test, expect } from '@playwright/test';

/**
 * 核心旅程 5：首页 DIY 的**跨组件状态共享**（真实缺陷的端到端验收）。
 *
 * 背景：`useHomeDIY()` 此前是「每个调用组件各自一份 useState + 各自从
 * localStorage 读一次」。首页有 6 个组件在用它（ViewModeToggle、
 * navigation-content、HomeDIYToolbar 的多个入口……），于是：
 *
 *   - 点 ViewModeToggle 里的「经典全景流」——改的是**切换器自己**那份 viewMode，
 *     navigation-content 那份纹丝不动：首屏展板不会消失，必须刷新页面才生效；
 *   - 点工具栏的「新建专属分类」——新分类写进了**工具栏自己**那份 config，
 *     导航区不重读 localStorage：首页上根本看不到这个分类。
 *
 * 修复是把它换成模块级单例 + useSyncExternalStore（见 #70 与
 * test/home-diy-store.test.ts）。单测钉的是共享存储的契约，
 * 这里钉的是「组件真的连上了同一份状态」——只有在浏览器里点一遍才算数。
 *
 * 三条用例都不依赖后端种子数据（CI 的 E2E 库是空库），
 * 需要数据的地方一律通过界面自己造。
 */
test.describe('核心旅程 5：首页 DIY 排版跨组件联动', () => {
  test('切换视图形态：首屏展板当场消失，不必刷新，且真的落盘', async ({ page }) => {
    await page.goto('/');

    // 默认是「极客混合流」：首屏展板（由 navigation-content 渲染）应在
    const deck = page.getByRole('heading', { name: /极速启动展板/ });
    await expect(deck).toBeVisible();

    // 切换发生在另一个组件里（ViewModeToggle），修复前两边状态是断开的
    await page.getByRole('button', { name: /首页视图形态/ }).click();
    await page.getByRole('menuitem', { name: '经典全景流' }).click();

    await expect(deck).toHaveCount(0);

    // 不只是「看着变了」：确实写进了本地存储
    const stored = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem('navhub_home_diy_config_v3') || '{}'),
    );
    expect(stored.viewMode).toBe('classic');

    // 刷新后仍然是经典流（切换器自己也要读到共享状态）
    await page.reload();
    await expect(page.getByRole('heading', { name: /极速启动展板/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /首页视图形态：当前为经典模式/ })).toBeVisible();
  });

  test('编排模式新建专属分类：导航区当场出现该分类与就地排版控件', async ({ page }) => {
    await page.goto('/');

    // 就地排版控件（拖拽/置顶/隐藏）只有 navigation-content 认为
    // 「正在编排」时才渲染 —— 它就是跨组件联动的探针
    const dragHandle = page.getByTitle('按住拖拽调整此分类在页面上的排列位置');
    await expect(dragHandle).toHaveCount(0);

    await page.getByRole('button', { name: /DIY 排版工坊/ }).click();
    await expect(page.getByRole('button', { name: /完成编排/ })).toBeVisible();

    // 基线不写死：CI 的 E2E 库是空库，分类可能来自构建期基线内容
    const baseline = await dragHandle.count();

    // 自己造一个分类（不依赖后端种子数据）
    await page.getByTitle('新建专属分类').click();
    await page.locator('#diy-new-category-title').fill('E2E 跨组件联动');
    await page.getByRole('button', { name: '确认创建' }).click();

    // 导航区（另一个组件）必须当场多出一个可编排的分类。
    // 修复前：新分类只写进工具栏自己那份 config，导航区既不显示它、
    // 也不会进入编排态 —— 下面这条恒为 baseline(=0)
    await expect(dragHandle).toHaveCount(baseline + 1);

    // 撤销走同一份共享历史：分类应立刻从导航区消失
    await page.getByTitle(/^撤销编排变更/).click();
    await expect(dragHandle).toHaveCount(baseline);

    // 关掉编排：导航区也要跟着退出（不能只关工具栏自己）
    await page.getByRole('button', { name: /完成编排/ }).click();
    await expect(dragHandle).toHaveCount(0);
  });

  test('本地存储写不进去：改动照旧生效，但必须明说刷新会丢', async ({ page }) => {
    // 只让 DIY 的键写失败（配额满 / 隐私模式的等效情形）
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (String(key).startsWith('navhub_home_diy')) {
          const err = new Error('The quota has been exceeded.');
          err.name = 'QuotaExceededError';
          throw err;
        }
        return original.call(this, key, value);
      };
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /极速启动展板/ })).toBeVisible();

    await page.getByRole('button', { name: /首页视图形态/ }).click();
    await page.getByRole('menuitem', { name: '经典全景流' }).click();

    // 改动在内存里照旧生效（不能因为存不下就假装没点）
    await expect(page.getByRole('heading', { name: /极速启动展板/ })).toHaveCount(0);
    // 但「没保存上」必须说出来，否则用户以为已经存好了
    await expect(page.getByRole('alert').filter({ hasText: '没能写入浏览器本地存储' })).toBeVisible();

    // 而且真没存下：刷新回到默认（这句同时证明上面那条提示不是摆设）
    await page.reload();
    await expect(page.getByRole('heading', { name: /极速启动展板/ })).toBeVisible();
  });
});
