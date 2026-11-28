import { test, expect, type Page } from '@playwright/test';

/**
 * SPEC-首访信任-2026-11-27（v2）· 首访引导可达性 e2e（W26 新增，只加测试）。
 *
 * 覆盖：
 *  - AC-1.1c（390 移动端：入口在「切换工作区与快捷功能」下拉内）
 *  - AC-1.1c（1440 桌面口径：移动端胶囊行隐藏、首层不重复露出引导入口）
 *  - AC-1.1d（1440 桌面：外观浮层 CTA 直接落 guide Tab，引导区当帧可见 —— F4′）
 *  - AC-1.2 （移动端点徽章 → 弹窗直接落「新手向导与设首页」Tab，三步可见）
 *  - AC-1.3 （三步按钮各自真的能点进去：/import、聚焦搜索框、/favorites）—— W37 新增
 *  - AC-1.4 （F2：引导键单独决定徽章；设首页键不影响徽章）
 *  - AC-2.3 （聚焦后 input 内容全选，按 selectionStart/End 判定）—— W37 新增
 *
 * 不在本文：AC-1.6b（要改服务端站点配置，单独成文 e2e/first-visit-module-toggle.spec.ts，
 * 避免写站点配置影响同进程内其它 spec）；AC-1.6 / AC-3.2 / AC-3.3（源码守卫，
 * 见 apps/web-overlay/test/first-visit-trust.test.ts）。
 *
 * 口径说明（写进断言的理由）：
 *  1. 组件级单测这条路是堵的（vitest `environment: "node"`、无 jsdom，见 SPEC §6.5①），
 *     所以 UI 交互只能在这一层验；AC-3.1a 的渲染/文案判定另用源码级守卫（见 overlay 测试）。
 *  2. 1440 桌面口径的「首层无引导入口」不是指整页没有入口，而是指：移动端胶囊行
 *     （`md:hidden`）在桌面不展示，桌面入口由外观浮层承担（AC-1.1b / AC-1.1d 覆盖）。
 *     因此这里断言的是「胶囊行触发器不可见 + 桌面工作区 tablist 可见 + 首层无菜单项」。
 *  3. 本轮不写 AC-1.1（v2 已按 B-1 裁决标记为【现状记录·F4′ 落地后作废】，禁止进门禁）。
 */

const MOBILE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;

/** 两把本机键（键名口径见 lib/onboarding.ts:15、lib/growth-lazy.ts:54） */
const ONBOARDING_KEY = 'navhub:onboarding:v1';
const HOMEPAGE_BANNER_KEY = 'navhub.growth.homepageBannerDismissed.v1';

/** 首页可交互判据：今日中心按钮是 SSR 常驻、水合后可点，用作「壳已就绪」锚点 */
async function gotoHomeReady(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '打开今日中心小窗', exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

/** 打开移动端「切换工作区与快捷功能」下拉 */
async function openQuickMenu(page: Page) {
  const trigger = page.getByRole('button', { name: '切换工作区与快捷功能', exact: true });
  await expect(trigger).toBeVisible({ timeout: 60_000 });
  await trigger.click();
  return trigger;
}

test.describe('AC-1.1c · 390×844：引导入口在移动胶囊行下拉内', () => {
  test.use({ viewport: MOBILE });

  test('首层无「向导与设首页」菜单项；点「切换工作区与快捷功能」后菜单项可见', async ({ page }) => {
    await gotoHomeReady(page);

    // 首层（未展开菜单）不该出现该菜单项——它不是常驻徽章，只在 DropdownMenuContent 挂载后存在
    await expect(page.getByRole('menuitem', { name: '向导与设首页', exact: true })).toHaveCount(0);

    await openQuickMenu(page);
    // 水合后 guidePending 由 localStorage 的 useEffect 置位；冷启动长尾给 60s 预算
    await expect(page.getByRole('menuitem', { name: '向导与设首页', exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });
});

test.describe('AC-1.1c · 1440×900 桌面口径', () => {
  test.use({ viewport: DESKTOP });

  test('移动胶囊行隐藏、桌面工作区 tablist 可见，首层不重复露出引导入口', async ({ page }) => {
    await gotoHomeReady(page);

    // md:hidden 的移动行在 1440 不展示（仍在 DOM 里，只能断言不可见，不能断言 count=0）
    await expect(
      page.getByRole('button', { name: '切换工作区与快捷功能', exact: true }),
    ).toBeHidden();

    // 桌面承接行：5 大工作区角色切换（home-capsule-row.tsx:248-279）
    await expect(page.getByRole('tablist', { name: '工作区视图切换' })).toBeVisible();

    // 首层不该有第二个「向导与设首页」入口（菜单内容未挂载 ⇒ DOM 里也没有该文案）
    await expect(page.getByText('向导与设首页', { exact: true })).toHaveCount(0);
  });
});

test.describe('AC-1.2 · 390×844：点徽章直达 guide Tab', () => {
  test.use({ viewport: MOBILE });

  test('弹窗打开且「新手向导与设首页」Tab aria-selected=true，三步列表可见', async ({ page }) => {
    await gotoHomeReady(page);

    await openQuickMenu(page);
    const badge = page.getByRole('menuitem', { name: '向导与设首页', exact: true });
    await expect(badge).toBeVisible({ timeout: 60_000 });
    await badge.click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });

    // navigation-content.tsx:1674-1677 的 onOpenGuideTab = setAppearanceTab('guide') + open，
    // 弹窗按 defaultTab 初始化（appearance-guide-dialog.tsx:67 / :83-85）
    const guideTab = page.getByRole('tab', { name: '新手向导与设首页' });
    await expect(guideTab).toHaveAttribute('aria-selected', 'true');

    const region = page.getByRole('region', { name: '新手引导' });
    await expect(region).toBeVisible({ timeout: 10_000 });
    // 三步 <ol>（onboarding-card.tsx:121-177）
    await expect(region.getByRole('listitem')).toHaveCount(3);
  });
});

test.describe('AC-1.4 · F2 两把键各自独立（只置一把键分别断言）', () => {
  test.use({ viewport: MOBILE });

  test('仅置引导键 = done → 徽章消失（设首页键未置）', async ({ page }) => {
    await page.addInitScript((key: string) => {
      localStorage.setItem(key, 'done');
    }, ONBOARDING_KEY);

    await gotoHomeReady(page);
    await openQuickMenu(page);
    // 菜单已展开，但引导项不得出现
    await expect(page.getByRole('menuitem', { name: '向导与设首页', exact: true })).toHaveCount(0);
  });

  test('仅置设首页键 = 1 → 徽章仍在（引导键未置）', async ({ page }) => {
    await page.addInitScript((key: string) => {
      localStorage.setItem(key, '1');
    }, HOMEPAGE_BANNER_KEY);

    await gotoHomeReady(page);
    await openQuickMenu(page);
    await expect(page.getByRole('menuitem', { name: '向导与设首页', exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });
});

test.describe('AC-1.1d · 1440×900：外观浮层 CTA 直接落 guide Tab（F4′）', () => {
  test.use({ viewport: DESKTOP });

  test('点 CTA 后「新手向导与设首页」Tab 已选中，且「新手引导」region 当帧可见（无需再点 Tab）', async ({
    page,
  }) => {
    await gotoHomeReady(page);

    // 两段式入口：顶栏浮层按钮 → 浮层内 CTA（appearance-quick-popover.tsx:96-110）
    await page.getByRole('button', { name: '打开外观与阅读设置' }).first().click();
    await page.getByRole('button', { name: '皮肤、壁纸、新手向导与 DIY 排版' }).click();

    const dialog = page.getByRole('dialog', { name: '外观排版与新手向导' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // F4′ 核心：CTA 传 'guide'（appearance-quick-popover.tsx:103
    // `onOpenAppearanceGuide('guide')`）→ navigation-content.tsx:921 的
    // handleOpenAppearanceGuide(tab='appearance') 收到 'guide' → setAppearanceTab('guide')
    // → 弹窗按 defaultTab 初始化（appearance-guide-dialog.tsx:67 / :84-85）
    const guideTab = dialog.getByRole('tab', { name: '新手向导与设首页' });
    await expect(guideTab).toHaveAttribute('aria-selected', 'true');

    // 「当帧可见」：不点 Tab 就应该看到引导区
    const region = dialog.getByRole('region', { name: '新手引导' });
    await expect(region).toBeVisible({ timeout: 10_000 });
    await expect(region.getByRole('listitem')).toHaveCount(3);
  });
});

/**
 * 打开外观向导小窗并**确保证落在 guide Tab**，返回 dialog 与引导区。
 * AC-1.3 的三步按钮都在这里面（onboarding-card.tsx 唯一渲染点 =
 * appearance-guide-dialog.tsx:358）。
 */
async function openGuideRegion(page: Page) {
  await page.getByRole('button', { name: '打开外观与阅读设置' }).first().click();
  await page.getByRole('button', { name: '皮肤、壁纸、新手向导与 DIY 排版' }).click();
  const dialog = page.getByRole('dialog', { name: '外观排版与新手向导' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  const guideTab = dialog.getByRole('tab', { name: '新手向导与设首页' });
  // F4′ 之后 CTA 已直落 guide；这里仍显式点一次，让本组用例不依赖 F4′ 的落地形态
  if ((await guideTab.getAttribute('aria-selected')) !== 'true') await guideTab.click();
  const region = dialog.getByRole('region', { name: '新手引导' });
  await expect(region).toBeVisible({ timeout: 10_000 });
  return { dialog, region };
}

test.describe('AC-1.3 · 三步按钮各自真的能点进去（onboarding-card.tsx:130-135 / :147-159 / :170-175）', () => {
  test.use({ viewport: DESKTOP });

  test('第 1 步「去导入」→ 路由变 /import', async ({ page }) => {
    await gotoHomeReady(page);
    const { region } = await openGuideRegion(page);

    // onboarding-card.tsx:131 `<Link href="/import">`，按钮文案 :132「去导入」
    await region.getByRole('link', { name: /去导入/ }).click();
    await expect(page).toHaveURL(/\/import(?:$|[/?#])/, { timeout: 15_000 });
  });

  test('第 2 步「试试搜索」→ document.activeElement 命中 input[data-search-input]', async ({ page }) => {
    await gotoHomeReady(page);
    const { region } = await openGuideRegion(page);

    // onboarding-card.tsx:151-155：
    //   onClick={() => { const input = document.querySelector<HTMLInputElement>(
    //     'input[data-search-input]'); input?.focus() }}
    //
    // DEFECT-2（W37 发现）已由 W39 的 onRequestSearch 注入点修复，本条复签转绿。
    //   根因回顾（W37 诊断，保留供后人）：
    //     A. 冷启动时 [data-search-input] 不在 DOM（LazySearchPalette 首帧只渲染占位），
    //        querySelector 返回 null → input?.focus() 空操作。
    //     B. 即便面板已挂载，Radix Dialog（appearance-guide-dialog.tsx 的 Dialog /
    //        DialogContent）焦点陷阱会把 activeElement 抢回弹窗内按钮。
    //   修复落点（生产源码，本单只验不改）：appearance-guide-dialog.tsx:170-177
    //     handleRequestSearch：先置 searchIntentRef → onOpenChange(false) 关弹窗解焦点陷阱
    //     → window rAF（跨组件卸载存活）→ 派发 navhub:focus-search 触发面板挂载
    //     → focusSearchInputWhenReady() 等 input 出现再 focus/select；
    //     onCloseAutoFocus 里按 searchIntentRef preventDefault 挡住 Radix 焦点归还。
    //     onboarding-card.tsx:113-119 的 requestSearch 在宿主注入时优先用该回调。
    //   本条是行为级断言（poll document.activeElement === 'search-input'），端到端覆盖
    //   整条注入链路，不是源码守卫；断言本身 W37 至今零改动。
    //   复签证据（2026-11-28）：trust 单跑 30/30 绿（23:16）、5 spec 合跑 64/64 绿（23:27），
    //   其中本条第 2 步均通过——注入点验证完成。
    await region.getByRole('button', { name: /试试搜索/ }).click();

    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            if (!active) return 'none';
            if (active.matches?.('input[data-search-input]')) return 'search-input';
            return `${active.tagName.toLowerCase()}|${active.getAttribute('aria-label') ?? ''}`;
          }),
        {
          timeout: 10_000,
          message:
            '第 2 步应把焦点送进顶栏搜索框（AC-1.3）。实际落在 dialog 内的元素上：' +
            '要么 input 尚未挂载（冷启动），要么 Radix Dialog 焦点陷阱夺回——两者皆为 DEFECT-2。',
        },
      )
      .toBe('search-input');
  });

  test('第 3 步「看看收藏」→ 路由变 /favorites', async ({ page }) => {
    await gotoHomeReady(page);
    const { region } = await openGuideRegion(page);

    // onboarding-card.tsx:171 `<Link href="/favorites">`，按钮文案 :172「看看收藏」
    await region.getByRole('link', { name: /看看收藏/ }).click();
    await expect(page).toHaveURL(/\/favorites(?:$|[/?#])/, { timeout: 15_000 });
  });
});

test.describe('AC-2.3 · 聚焦后 input 内容全选（断言 selectionStart/End，不读 Selection 对象）', () => {
  test.use({ viewport: DESKTOP });

  test('输入框有内容时按 ⌘/Ctrl+K：selectionStart===0 且 selectionEnd===value.length', async ({
    page,
  }) => {
    await gotoHomeReady(page);

    // 等网守监听挂上（与 first-visit-shortcut.spec.ts:41-50 同一判据）
    await expect(page.getByRole('button', { name: /搜索站点、标签或拼音/ })).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForFunction(() => {
      const trigger = document.querySelector('button[aria-label^="搜索站点、标签或拼音"]');
      return !!trigger && Object.keys(trigger).some((key) => key.startsWith('__reactFiber$'));
    });

    // 先按一次把搜索框唤出来，再灌入内容。
    // ⚠️ 必须先有内容：空 value 时 selectionStart===0 && selectionEnd===0 恒成立，
    //    直接断言就是**伪测试**（0===0 && 0===0）。下面 value.length > 0 是防空断言。
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.locator('[data-search-input]');
    await expect(input).toBeVisible({ timeout: 10_000 });
    const typed = 'playwright 全选验证';
    await input.fill(typed);

    // 再按一次 ⌘K：实现走 global-spotlight-gateway.tsx:66-68
    //   e.preventDefault(); input.focus(); input.select()
    await page.keyboard.press('ControlOrMeta+k');

    const sel = await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('[data-search-input]');
      if (!el) return null;
      return { start: el.selectionStart, end: el.selectionEnd, len: el.value.length, value: el.value };
    });

    expect(sel, '找不到 [data-search-input]').not.toBeNull();
    // 防空断言：value 为空时 selection 0..0 是恒真，必须先证明真的有内容可全选
    expect(sel!.len, '输入框为空时「全选」断言恒成立，是伪测试').toBeGreaterThan(0);
    expect(sel!.value).toBe(typed);
    expect(sel!.start).toBe(0);
    expect(sel!.end).toBe(sel!.len);
  });
});
