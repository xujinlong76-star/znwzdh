import { test, expect, type Page } from '@playwright/test';

/**
 * 半屏下沉栏 HalfScreenDock（Batch 3 第 12 项）BLOCK 修复的 E2E 回归。
 *
 * 背景：独立评审 BLOCK——640–1024px 区间，栏的关闭 × 默认就被小猫挂件
 * （#xiaomaomao，.xm-lean 满幅拦截指针）盖住、点不到；700px 时热度榜还被
 * DIY 入口 pill 盖住。修复：pill 在 640–1024 抬到 4.5rem；猫在 640–1024
 * 默认抬到 112px（K1 悬浮栈规范 f0283bb8：猫底边 96px→112px，见下）。
 *
 * 本文件把 elementFromPoint 实测固化下来：700/900 下 × 与热度榜的中心点命中
 * 目标必须是其自身（不是 .xm-lean、不是 HomeQuickDock）；639/640/1023/1024 四边界
 * 显隐符合 [640,1024)；猫的拖动、60 秒贴边、面板展开三处无回归。
 *
 * 2026-11-18 改写（44394500 首页极简首屏 + 五大功能小窗化）：
 * 旧门条件「等 DIY 入口 pill 可见」已作废——pill 随 44394500 有意撤掉
 * （hideStaticButton，全树只剩死代码文案）；门条件改为 dock 自身可见 +
 * 工具栏外观按钮可见。旧遮挡源 pill 已消失；hitTest 增加 inQuickDock 断言，
 * 直接回答新加的 HomeQuickDock（页内流式 section）是否遮挡 × 或热度榜。
 *
 * 猫底距现行值（xiaomaomao.js，与四边界期望逐字对齐；K1 2026-11-17 修正，
 * f0283bb8：猫底边 96px→112px，640–1023px 档与桌面同值；旧值 640/1023→90px、
 * 1024→96px 是 K1 前的过期期望）：<640px 为 68px
 *（@media max-width:640px；640px 整点以 640–1023px 规则为准）；
 * 640–1023px 为 112px；≥1024px 为桌面默认 112px。改挂件 CSS 时须同步改本文件期望值。
 *
 * 注意：elementFromPoint 返回的是最上层元素——按钮中心是 lucide <svg>，
 * 所以断言用 target.contains(hit)，而不是 hit === target。
 */

const DOCK = 'nav[aria-label="半屏快捷操作"]';
const CLOSE_BTN = 'button[aria-label="关闭半屏下沉栏"]';
const HOT_LINK = 'a[aria-label="热度趋势榜"]';
const CAT = '#xiaomaomao';
const APPEARANCE_BTN = '打开外观排版与新手向导小窗';

async function gotoHome(page: Page, width: number, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // 首访冷编译预热：宽预算、失败不致命（可能已编译过）
  await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
  await expect(page.locator(CAT)).toBeAttached({ timeout: 60_000 });
}

async function expectDockVisible(page: Page): Promise<void> {
  await expect(page.locator(DOCK)).toBeVisible({ timeout: 60_000 });
  // 首页已加载且工具栏已挂载的证明（工具栏外观按钮在 700/900px 下是常驻图标钮）；
  // 旧门条件「等 DIY 入口 pill」已随 44394500 撤掉，不再等待。
  await expect(page.getByRole('button', { name: APPEARANCE_BTN })).toBeVisible({ timeout: 30_000 });
  // 入场动画（xm-enter .32s）落定，避免量到动画中途的几何
  await page.waitForTimeout(600);
}

/** 中心点命中判定：返回命中元素描述 + 是否落在目标内 / 猫内 / 快捷坞内 */
async function hitTest(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${selector} 应有几何`).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  const res = await page.evaluate(
    ({ cx, cy, selector }) => {
      const target = document.querySelector(selector);
      const el = document.elementFromPoint(cx, cy) as Element | null;
      if (!target || !el) return { ok: false, hit: null, inCat: false, inQuickDock: false };
      return {
        ok: target.contains(el),
        hit: el.outerHTML.slice(0, 160),
        inCat: !!el.closest('#xiaomaomao'),
        inQuickDock: !!el.closest('#quick-access-tray'),
      };
    },
    { cx, cy, selector },
  );
  expect(res.ok, `${selector} 中心点 (${Math.round(cx)},${Math.round(cy)}) 命中了 ${res.hit}，不是目标本身`).toBe(true);
  expect(res.inCat, `${selector} 中心点被小猫挂件盖住：${res.hit}`).toBe(false);
  expect(res.inQuickDock, `${selector} 中心点被 HomeQuickDock 盖住：${res.hit}`).toBe(false);
  return { cx, cy };
}

test.describe('半屏下沉栏遮挡回归（BLOCK 修复）', () => {
  test('700px：关闭 × 与热度榜命中自身；真点击 × 能关栏', async ({ page }) => {
    await gotoHome(page, 700);
    await expectDockVisible(page);
    await hitTest(page, CLOSE_BTN);
    await hitTest(page, HOT_LINK);
    // 真点击是最强的证明：鼠标点 × 中心，栏关闭 + toast 出现
    const { cx, cy } = await hitTest(page, CLOSE_BTN);
    await page.mouse.click(cx, cy);
    await expect(page.locator(DOCK)).toBeHidden({ timeout: 10_000 });
    // exact 全文：toast 标题 div 与 aria-live 播报 span 文案有重叠，子串会命中两个
    await expect(page.getByText('已关闭半屏下沉栏，可在设置页重新打开', { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test('900px：关闭 × 与热度榜命中自身', async ({ page }) => {
    await gotoHome(page, 900);
    await expectDockVisible(page);
    await hitTest(page, CLOSE_BTN);
    await hitTest(page, HOT_LINK);
  });

  test('四边界：639/640/1023/1024 栏显隐符合 [640,1024)，猫底距同步切换', async ({ page }) => {
    const cases: Array<{ width: number; dockVisible: boolean; catBottom: string }> = [
      { width: 639, dockVisible: false, catBottom: '68px' },
      { width: 640, dockVisible: true, catBottom: '112px' },
      { width: 1023, dockVisible: true, catBottom: '112px' },
      { width: 1024, dockVisible: false, catBottom: '112px' },
    ];
    for (const { width, dockVisible, catBottom } of cases) {
      await gotoHome(page, width);
      const dock = page.locator(DOCK);
      if (dockVisible) await expect(dock).toBeVisible({ timeout: 60_000 });
      else await expect(dock).toBeHidden({ timeout: 60_000 });
      const bottom = await page.evaluate(() => {
        const el = document.querySelector('#xiaomaomao') as HTMLElement | null;
        return el ? getComputedStyle(el).bottom : null;
      });
      expect(bottom, `${width}px 下猫的 computed bottom`).toBe(catBottom);
    }
  });

  test('猫可拖动且位置持久化（拖过的猫以用户自选位置为准）', async ({ page }) => {
    await gotoHome(page, 700);
    await expectDockVisible(page);
    // U-260 前置（2026-11-21，与 :178 同因）：首屏瘦身后全新 profile 下猫默认收起
    // （closed: true），.xm-main-col 被 display:none，拖动监听挂在 .xm-stage 上，
    // 收起态拖了也写不出行内 left/top（CI 抽样：:138「拖动后应写行内 left」；
    // 本地复现同错）。先点收起徽标（.xm-tab）展开再拖；其余断言一字不动。
    const isClosed = await page.evaluate(
      () => document.querySelector('#xiaomaomao')?.classList.contains('xm-closed') ?? false,
    );
    if (isClosed) {
      await page.locator(`${CAT} .xm-tab`).click({ timeout: 10_000 });
      await page.waitForFunction(
        () => !document.querySelector('#xiaomaomao')?.classList.contains('xm-closed'),
        { timeout: 10_000 },
      );
      await page.waitForTimeout(600); // 入场动画（xm-enter .32s）落定
    }
    const cat = page.locator(`${CAT} .xm-stage`);
    const before = await page.locator(CAT).boundingBox();
    expect(before).not.toBeNull();
    const startX = before!.x + before!.width / 2;
    const startY = before!.y + before!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 120, startY - 80, { steps: 12 });
    await page.mouse.up();
    // 拖动写行内 left/top（不是样式表 bottom）
    const inline = await page.evaluate(() => {
      const el = document.querySelector('#xiaomaomao') as HTMLElement | null;
      return el ? { left: el.style.left, top: el.style.top } : null;
    });
    expect(inline?.left, '拖动后应写行内 left').not.toBe('');
    expect(inline?.top, '拖动后应写行内 top').not.toBe('');
    const dragged = await page.locator(CAT).boundingBox();
    expect(dragged!.x).toBeCloseTo(before!.x - 120, 0);
    expect(dragged!.y).toBeCloseTo(before!.y - 80, 0);
    // 刷新后位置还在（localStorage navhub.xiaomaomao.v1 持久化）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(CAT)).toBeAttached({ timeout: 60_000 });
    // 入场动画 xmPop（.32s，根节点 scale+translateY）落定后再量几何：
    // 否则量到动画中途的 boundingBox，x/y 会差零点几 px 而误报
    //（2026-11-16 实测：两次失败分别差 0.52px / 1.14px，均刚过 0.5px 阈值）
    await page.waitForTimeout(500);
    const after = await page.locator(CAT).boundingBox();
    expect(after!.x).toBeCloseTo(dragged!.x, 0);
    expect(after!.y).toBeCloseTo(dragged!.y, 0);
  });

  test('猫面板展开后仍在视口内（抬高后面板随猫上移、不出视口）', async ({ page }) => {
    await gotoHome(page, 700);
    await expectDockVisible(page);
    // U-260 前置（2026-11-21，与 :121/:178 同因）：全新 profile 下猫默认收起，
    // .xm-stage 被 display:none，boundingBox() 取到 null（CI :162 同错，
    // 本地复现同错）。先点收起徽标展开再量面板；其余断言一字不动。
    const isClosed = await page.evaluate(
      () => document.querySelector('#xiaomaomao')?.classList.contains('xm-closed') ?? false,
    );
    if (isClosed) {
      await page.locator(`${CAT} .xm-tab`).click({ timeout: 10_000 });
      await page.waitForFunction(
        () => !document.querySelector('#xiaomaomao')?.classList.contains('xm-closed'),
        { timeout: 10_000 },
      );
      await page.waitForTimeout(600); // 入场动画（xm-enter .32s）落定
    }
    // 桌面悬停唤出悬浮坞，再点聊天钮开面板。注意不用 page.hover('.xm-stage')：
    // .xm-stage 带无限 xmFloat 浮动动画，Playwright 的 hover 要等元素 stable，
    // 永远等不到而超时；mouse.move 不做 stable 检查，同样能触发 root 的 pointerenter。
    // U-260 续（2026-11-21）：点圆标展开时鼠标已在猫身上——pointerenter 在
    // xm-closed 下被 ctlBlocked() 拦住，展开后鼠标不出根节点就不再触发，
    // 坞永不出、聊天钮点不到（本地复现：.xm-chat-btn 10 秒 not visible）。
    // 先把鼠标移出猫的范围再移入，触发一次新的 pointerenter。
    const stageBox = await page.locator(`${CAT} .xm-stage`).boundingBox();
    expect(stageBox).not.toBeNull();
    await page.mouse.move(10, 10);
    await page.mouse.move(stageBox!.x + stageBox!.width / 2, stageBox!.y + stageBox!.height / 2);
    await page.locator(`${CAT} .xm-chat-btn`).click({ timeout: 10_000 });
    const panel = page.locator(`${CAT} .xm-panel`);
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400); // xmPanelIn .24s 入场动画落定后再量几何
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x, '面板左缘不出视口').toBeGreaterThanOrEqual(0);
    expect(box!.y, '面板上缘不出视口').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, '面板右缘不出视口').toBeLessThanOrEqual(700);
    expect(box!.y + box!.height, '面板下缘不出视口').toBeLessThanOrEqual(900);
    await page.locator(`${CAT} .xm-p-close`).click();
    await expect(panel).toBeHidden({ timeout: 10_000 });
  });

  test('60 秒闲置贴边仍生效，且贴边后 × 仍可点', async ({ page }) => {
    test.setTimeout(180_000);
    await gotoHome(page, 700);
    await expectDockVisible(page);
    // U-260 前置（2026-11-20）：首屏默认收起后，全新 profile 下挂件默认是收起态
    // （closed: true），dockBlocked() 把 xm-closed 列为守门条件，doDock() 一进就
    // return，translateX 永不写入——收起态不贴边是既定设计
    // （xiaomaomao.js:2321 dockBlocked、2358 行注释「聊天/游戏/收起态不缩」），不是 bug。
    // 故先点收起徽标（.xm-tab，aria-label「叫出小猫猫」）把猫展开，等 xm-closed 摘掉、
    // 入场动画落定后再开始 60 秒闲置计时，测「展开态贴边」；其余断言一字不动。
    // 点徽标本身会调 markActive() 重置闲置计时，60 秒从展开后算起。
    const isClosed = await page.evaluate(
      () => document.querySelector('#xiaomaomao')?.classList.contains('xm-closed') ?? false,
    );
    if (isClosed) {
      await page.locator(`${CAT} .xm-tab`).click({ timeout: 10_000 });
      await page.waitForFunction(
        () => !document.querySelector('#xiaomaomao')?.classList.contains('xm-closed'),
        { timeout: 10_000 },
      );
      await page.waitForTimeout(600); // 入场动画（xm-enter .32s）落定
    }
    // 不动鼠标、不碰键盘：60 秒后猫应横向贴边（只写 transform，不动 bottom）
    await page.waitForFunction(
      () => {
        const el = document.querySelector('#xiaomaomao') as HTMLElement | null;
        return !!el && el.style.transform.includes('translateX');
      },
      { timeout: 75_000 },
    );
    const transform = await page.evaluate(
      () => (document.querySelector('#xiaomaomao') as HTMLElement).style.transform,
    );
    expect(transform).toContain('translateX');
    // 贴边是横向位移，猫底缘仍在栏之上：× 仍命中自身
    await hitTest(page, CLOSE_BTN);
  });
});
