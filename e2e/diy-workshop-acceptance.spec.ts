import { test, expect, type Page, type Locator } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3000';
// 兼容本地 macOS 与 GitHub Actions Linux CI 的快捷键修饰符
const MOD_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';
// 本仓实际 DIY 布局持久化 Key
const LAYOUT_STORAGE_KEY = 'navhub_home_diy_config_v3';
const FEATURE_MASK_KEY = 'navhub_feature_mask_v1';

// ============================================================================
// 通用拖拽与辅助工具（专为 @dnd-kit + react-grid-layout 调优）
// ============================================================================

/**
 * 拟真平滑拖拽到目标元素
 * 解决 @dnd-kit activationConstraint (distance: 6) 与 RGL 指针碰撞丢帧问题
 */
async function smoothDragTo(
  page: Page,
  source: Locator,
  target: Locator,
  options?: {
    targetPosition?: { xRatio?: number; yRatio?: number };
    steps?: number;
    holdMs?: number;
  }
) {
  await source.scrollIntoViewIfNeeded();
  const srcBox = await source.boundingBox();
  const dstBox = await target.boundingBox();
  if (!srcBox || !dstBox) {
    throw new Error('拖拽元素或目标元素未渲染（boundingBox 为空）');
  }

  const startX = srcBox.x + srcBox.width / 2;
  const startY = srcBox.y + srcBox.height / 2;
  const endX = dstBox.x + dstBox.width * (options?.targetPosition?.xRatio ?? 0.5);
  const endY = dstBox.y + dstBox.height * (options?.targetPosition?.yRatio ?? 0.5);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 先微移 10px 稳定触发 PointerSensor 的 distance 阈值
  await page.mouse.move(startX + 10, startY + 2, { steps: 3 });
  await page.waitForTimeout(80);
  // 分步平滑移动至目标点，触发容器碰撞检测与占位槽计算
  await page.mouse.move(endX, endY, { steps: options?.steps ?? 18 });
  await page.waitForTimeout(options?.holdMs ?? 150);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** 按相对像素位移平滑拖拽（适用于 RGL 区块移位与边缘缩放手柄） */
async function smoothDragByDelta(
  page: Page,
  handle: Locator,
  deltaX: number,
  deltaY: number,
  steps = 16
) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) throw new Error('抓手元素未渲染');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 6, startY + 2, { steps: 2 });
  await page.waitForTimeout(60);
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(280);
}

async function enterDiyMode(page: Page) {
  const toolbar = page.getByTestId('diy-toolbar');
  if (await toolbar.isVisible().catch(() => false)) return;
  const toggleBtn = page.getByTestId('diy-toggle-btn').first();
  if (await toggleBtn.isVisible().catch(() => false)) {
    await toggleBtn.click();
    // 若触发了外观向导小窗，自动点击其中的「开启 DIY」进入编排态
    const startBtn = page.getByRole('button', { name: '开启 DIY', exact: true });
    if (await startBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
      await startBtn.click();
    }
  } else {
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press(`${MOD_KEY}+e`);
  }
  await expect(toolbar).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-bento-canvas="rgl"]')).toBeVisible({ timeout: 15_000 });
}

async function getCardIdsInBlock(block: Locator): Promise<string[]> {
  return block.getByTestId('site-card').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-site-id') || el.textContent?.trim() || '')
  );
}

/** 将前两块设为 6+6 左右并排（优先直接用右侧边缩放手柄 e，再拖块 B 抓手到块 A 右侧） */
async function arrangeFirstTwoSideBySide(page: Page) {
  const blockA = page.getByTestId('layout-block').nth(0);
  const blockB = page.getByTestId('layout-block').nth(1);
  await expect(blockA).toBeVisible({ timeout: 15_000 });
  await expect(blockB).toBeVisible({ timeout: 15_000 });

  const initialBoxA = (await blockA.boundingBox())!;
  const halfWidthDelta = -(initialBoxA.width * 0.5);

  // 1) 通过右侧边缩放手柄（block-resize-e）分别缩至 6 列宽
  await smoothDragByDelta(page, blockA.getByTestId('block-resize-e'), halfWidthDelta, 0);
  await smoothDragByDelta(page, blockB.getByTestId('block-resize-e'), halfWidthDelta, 0);

  const resizedBoxA = (await blockA.boundingBox())!;
  expect(resizedBoxA.width).toBeLessThan(initialBoxA.width * 0.65);

  // 2) 若 B 仍在 A 下方，通过大纲态或直接抓手把 B 拖到 A 的右侧空白区实现并排
  const bBoxBefore = (await blockB.boundingBox())!;
  if (Math.abs(resizedBoxA.y - bBoxBefore.y) > 20 || bBoxBefore.x <= resizedBoxA.x + 100) {
    // 借用大纲全景避免跨 2000px 长滚动，验证真 RGL 抓手拖至右侧并排
    await page.getByTestId('diy-btn-outline').click();
    await expect(page.locator('[data-bento-canvas="rgl"]')).toHaveAttribute('data-bento-outline', 'true');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);

    const oBoxA = (await blockA.boundingBox())!;
    const handleB = blockB.getByTestId('block-drag-handle');
    const hBBox = (await handleB.boundingBox())!;
    const targetRightX = oBoxA.x + oBoxA.width + 80;
    const targetTopY = oBoxA.y + oBoxA.height / 2;

    await smoothDragByDelta(
      page,
      handleB,
      targetRightX - (hBBox.x + hBBox.width / 2),
      targetTopY - (hBBox.y + hBBox.height / 2),
      20
    );

    await page.getByTestId('diy-btn-outline').click();
    await expect(page.locator('[data-bento-canvas="rgl"]')).toHaveAttribute('data-bento-outline', 'false');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
  }
}

// ============================================================================
// Phase 1：卡片自由排序、跨组精准落位、撤销重做、回收站与 UI 精修验证
// ============================================================================

test.describe('DIY 排版工坊 - Phase 1', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ k1, k2 }) => {
        localStorage.removeItem(k1);
        localStorage.removeItem(k2);
      },
      { k1: LAYOUT_STORAGE_KEY, k2: FEATURE_MASK_KEY }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('layout-block').first()).toBeVisible({ timeout: 20_000 });
  });

  test('1.1 同分类内自由拖拽排序并持久化生效', async ({ page }) => {
    await enterDiyMode(page);

    const firstBlock = page.getByTestId('layout-block').first();
    const initialOrder = await getCardIdsInBlock(firstBlock);
    expect(initialOrder.length).toBeGreaterThanOrEqual(3);

    const card0 = firstBlock.getByTestId('site-card').nth(0);
    const card2 = firstBlock.getByTestId('site-card').nth(2);

    // 将第 1 张卡片拖到第 3 张卡片右侧
    await smoothDragTo(page, card0, card2, {
      targetPosition: { xRatio: 0.8, yRatio: 0.5 },
    });

    const reordered = await getCardIdsInBlock(firstBlock);
    expect(reordered[0]).not.toBe(initialOrder[0]);
    expect(reordered.indexOf(initialOrder[0])).toBeGreaterThanOrEqual(2);

    // 等待防抖落盘（300ms）后刷新页面验证持久化
    await page.waitForTimeout(450);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(async () => (await getCardIdsInBlock(page.getByTestId('layout-block').first())).slice(0, 3), {
        timeout: 10_000,
      })
      .toEqual(reordered.slice(0, 3));
  });

  test('1.2 跨分类拖拽精准落位（数量变化 + 指定索引插入）', async ({ page }) => {
    test.setTimeout(90_000);
    await enterDiyMode(page);
    // 先将前两块并排，让源分组与目标分组同屏相邻（无需跨 2000px 滚动）
    await arrangeFirstTwoSideBySide(page);

    const sourceBlock = page.getByTestId('layout-block').nth(0);
    const targetBlock = page.getByTestId('layout-block').nth(1);

    const srcBefore = await getCardIdsInBlock(sourceBlock);
    const dstBefore = await getCardIdsInBlock(targetBlock);
    const draggedSiteId = srcBefore[0];

    // 将源分组第 1 张卡拖到目标分组第 1 张卡的左侧/前部位置
    await smoothDragTo(
      page,
      sourceBlock.getByTestId('site-card').nth(0),
      targetBlock.getByTestId('site-card').nth(0),
      { targetPosition: { xRatio: 0.2, yRatio: 0.5 }, steps: 24 }
    );

    const srcAfter = await getCardIdsInBlock(sourceBlock);
    const dstAfter = await getCardIdsInBlock(targetBlock);

    expect(srcAfter.length).toBe(srcBefore.length - 1);
    expect(srcAfter).not.toContain(draggedSiteId);
    expect(dstAfter.length).toBe(dstBefore.length + 1);
    // 验证不是简单追加末尾，而是精准落在靠前位置
    expect(dstAfter.indexOf(draggedSiteId)).toBeLessThanOrEqual(1);
  });

  test('1.3 快捷键 Undo / Redo 历史栈精确回滚与恢复', async ({ page }) => {
    await enterDiyMode(page);

    const block = page.getByTestId('layout-block').first();
    const before = await getCardIdsInBlock(block);

    await smoothDragTo(
      page,
      block.getByTestId('site-card').nth(0),
      block.getByTestId('site-card').nth(1),
      { targetPosition: { xRatio: 0.85, yRatio: 0.5 } }
    );

    const afterDrag = await getCardIdsInBlock(block);
    expect(afterDrag).not.toEqual(before);

    // 撤销：Cmd/Ctrl + Z
    await page.keyboard.press(`${MOD_KEY}+z`);
    await expect.poll(() => getCardIdsInBlock(block)).toEqual(before);

    // 重做：Cmd/Ctrl + Shift + Z
    await page.keyboard.press(`${MOD_KEY}+Shift+Z`);
    await expect.poll(() => getCardIdsInBlock(block)).toEqual(afterDrag);
  });

  test('1.4 悬停胶囊隐藏卡片至回收站并支持原位还原', async ({ page }) => {
    await enterDiyMode(page);

    const block = page.getByTestId('layout-block').first();
    const initialIds = await getCardIdsInBlock(block);
    const targetId = initialIds[0];

    // 仅悬停触发操作胶囊（验证编辑态无常驻噪音按钮）
    const firstCard = block.getByTestId('site-card').nth(0);
    await firstCard.hover();
    const hideBtn = firstCard.getByTestId('card-action-hide');
    await expect(hideBtn).toBeVisible();
    await hideBtn.click();

    await expect.poll(() => getCardIdsInBlock(block)).not.toContain(targetId);

    // 打开回收站一键还原
    await page.getByTestId('diy-btn-trash').click();
    await page.getByTestId('trash-restore-btn').first().click();

    await expect.poll(() => getCardIdsInBlock(block)).toContain(targetId);
  });

  test('1.5 窄视口（390x844）底部工具栏零溢出 & 分类 Tag 无竖排折字', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('layout-block').first()).toBeVisible({ timeout: 20_000 });
    await enterDiyMode(page);

    // 断言 1：页面无意外横向滚动溢出
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(hasHorizontalOverflow).toBe(false);

    // 断言 2：底部工具栏「完成」按钮完全在 390px 视口内且可点击
    const doneBtn = page.getByTestId('diy-btn-done');
    await expect(doneBtn).toBeVisible();
    const doneBox = await doneBtn.boundingBox();
    expect(doneBox).not.toBeNull();
    expect(doneBox!.x).toBeGreaterThanOrEqual(0);
    expect(doneBox!.x + doneBox!.width).toBeLessThanOrEqual(390);

    // 断言 3：所有可见分类 Tag 禁止被挤压成单字竖排
    const tags = page.getByTestId('category-tag');
    const tagCount = await tags.count();
    for (let i = 0; i < Math.min(tagCount, 10); i++) {
      const tag = tags.nth(i);
      if (await tag.isVisible()) {
        const box = await tag.boundingBox();
        const whiteSpace = await tag.evaluate((el) => getComputedStyle(el).whiteSpace);
        expect(whiteSpace).toBe('nowrap');
        // 单行 Tag 高度应远小于多行竖排高度（防竖排折字硬阈值）
        expect(box!.height).toBeLessThan(36);
      }
    }
  });
});

// ============================================================================
// Phase 2：V1->V2 迁移、12 列自由缩放并排、双层拖拽隔离、大纲态与断点隔离
// ============================================================================

test.describe('DIY 排版工坊 - Phase 2', () => {
  test('2.1 V1 旧版布局数据自动无损迁移至 WorkspaceLayoutV2', async ({ page }) => {
    // 在页面脚本运行前预置 Phase 1 / V1 旧版持久化快照
    const mockV1Layout = {
      version: 1,
      categoryOrder: ['ai-tools', 'dev-resources'],
      hiddenSites: ['legacy-hidden-site-1'],
      customSiteOrders: {
        'ai-tools': ['site-b', 'site-a'],
      },
    };

    await page.addInitScript(
      ({ key, data }) => {
        localStorage.setItem(key, JSON.stringify(data));
      },
      { key: LAYOUT_STORAGE_KEY, data: mockV1Layout }
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    // 校验存储已被幂等升维至 V2 Schema 且完整保留旧数据
    await expect
      .poll(
        async () =>
          page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed.workspaceLayoutV2 ?? parsed;
          }, LAYOUT_STORAGE_KEY),
        { timeout: 10_000 }
      )
      .toMatchObject({
        version: 2,
        gridConfig: { columns: 12 },
      });

    const migrated = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.workspaceLayoutV2 ?? parsed;
    }, LAYOUT_STORAGE_KEY);

    expect(Array.isArray(migrated.breakpoints?.lg)).toBe(true);
    expect(Array.isArray(migrated.breakpoints?.md)).toBe(true);
    expect(Array.isArray(migrated.breakpoints?.sm)).toBe(true);
    // 校验旧版隐藏与排序数据未丢失
    expect(JSON.stringify(migrated)).toContain('legacy-hidden-site-1');
    expect(JSON.stringify(migrated)).toContain('site-b');
  });

  test('2.2 12 列自由缩放 + 左右并排摆放 + 刷新持久化', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ k1, k2 }) => {
        localStorage.removeItem(k1);
        localStorage.removeItem(k2);
      },
      { k1: LAYOUT_STORAGE_KEY, k2: FEATURE_MASK_KEY }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterDiyMode(page);

    await arrangeFirstTwoSideBySide(page);

    const blockA = page.getByTestId('layout-block').nth(0);
    const blockB = page.getByTestId('layout-block').nth(1);
    const boxA = (await blockA.boundingBox())!;
    const boxB = (await blockB.boundingBox())!;

    // 校验两者处于同一水平行且 B 在 A 右侧
    expect(Math.abs(boxA.y - boxB.y)).toBeLessThan(16);
    expect(boxB.x).toBeGreaterThanOrEqual(boxA.x + boxA.width - 4);

    // 刷新页面确认并排布局持久化
    await page.waitForTimeout(450);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(async () => page.getByTestId('layout-block').nth(0).getAttribute('data-bento-w'), {
        timeout: 10_000,
      })
      .toBe('6');
    const persistedA = (await page.getByTestId('layout-block').nth(0).boundingBox())!;
    const persistedB = (await page.getByTestId('layout-block').nth(1).boundingBox())!;
    expect(Math.abs(persistedA.y - persistedB.y)).toBeLessThan(16);
    expect(persistedB.x).toBeGreaterThanOrEqual(persistedA.x + persistedA.width - 4);
  });

  test('2.3 双层拖拽事件隔离：拖卡片不动区块，拖区块不乱卡片', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ k1, k2 }) => {
        localStorage.removeItem(k1);
        localStorage.removeItem(k2);
      },
      { k1: LAYOUT_STORAGE_KEY, k2: FEATURE_MASK_KEY }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterDiyMode(page);
    await arrangeFirstTwoSideBySide(page);

    const blockA = page.getByTestId('layout-block').nth(0);
    const blockB = page.getByTestId('layout-block').nth(1);
    const blockAId = await blockA.getAttribute('data-block-id');

    // 记录拖拽前外层区块位置
    const blockABefore = (await blockA.boundingBox())!;
    const blockBBefore = (await blockB.boundingBox())!;

    // 动作 1：在区块 A 内拖动卡片并跨入右侧区块 B
    await smoothDragTo(
      page,
      blockA.getByTestId('site-card').nth(0),
      blockB.getByTestId('site-card').nth(0),
      { steps: 20 }
    );

    // 断言外层区块 x/y 未被误拖偏移（允许高度随内容微调）
    const blockAAfterCardDrag = (await blockA.boundingBox())!;
    const blockBAfterCardDrag = (await blockB.boundingBox())!;
    expect(Math.abs(blockAAfterCardDrag.x - blockABefore.x)).toBeLessThan(4);
    expect(Math.abs(blockAAfterCardDrag.y - blockABefore.y)).toBeLessThan(4);
    expect(Math.abs(blockBAfterCardDrag.x - blockBBefore.x)).toBeLessThan(4);

    // 动作 2：通过外层标题抓手左右交换区块位置，校验区块内卡片顺序未被篡改
    const cardsInABefore = await getCardIdsInBlock(blockA);
    const handleA = blockA.getByTestId('block-drag-handle');
    await smoothDragByDelta(page, handleA, blockABefore.width + 120, 0, 20);

    // 通过 data-block-id 重新定位原区块 A
    const movedBlockA = page.locator(`[data-testid="layout-block"][data-block-id="${blockAId}"]`);
    const cardsInAAfter = await getCardIdsInBlock(movedBlockA);
    expect(cardsInAAfter).toEqual(cardsInABefore);
  });

  test('2.4 大纲全景模式切换与拖动落位不跳变', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ k1, k2 }) => {
        localStorage.removeItem(k1);
        localStorage.removeItem(k2);
      },
      { k1: LAYOUT_STORAGE_KEY, k2: FEATURE_MASK_KEY }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterDiyMode(page);

    const firstBlock = page.getByTestId('layout-block').nth(0);
    const firstBlockId = await firstBlock.getAttribute('data-block-id');
    const expandedHeight = (await firstBlock.boundingBox())!.height;

    // 开启大纲全景态，校验所有区块压缩为紧凑胶囊高度
    await page.getByTestId('diy-btn-outline').click();
    await expect
      .poll(async () => (await firstBlock.boundingBox())!.height)
      .toBeLessThan(Math.min(expandedHeight, 140));

    // 在紧凑态下拖动区块换位，再关闭大纲态恢复展开
    const handle0 = firstBlock.getByTestId('block-drag-handle');
    await smoothDragByDelta(page, handle0, 0, 140, 15);
    await page.getByTestId('diy-btn-outline').click();

    const movedBlock = page.locator(`[data-testid="layout-block"][data-block-id="${firstBlockId}"]`);
    await expect
      .poll(async () => (await movedBlock.boundingBox())!.height)
      .toBeGreaterThanOrEqual(expandedHeight * 0.8);
  });

  test('2.5 多断点独立记忆：窄屏自动单列，切回宽屏保留并排坐标', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      ({ k1, k2 }) => {
        localStorage.removeItem(k1);
        localStorage.removeItem(k2);
      },
      { k1: LAYOUT_STORAGE_KEY, k2: FEATURE_MASK_KEY }
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await enterDiyMode(page);

    await arrangeFirstTwoSideBySide(page);

    const blockA = page.getByTestId('layout-block').nth(0);
    const blockB = page.getByTestId('layout-block').nth(1);

    // 切换至窄屏（sm: 390px），校验自动回退为上下单列、无横向溢出
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => page.locator('[data-bento-canvas]').getAttribute('data-bento-bp'), {
        timeout: 8_000,
      })
      .toBe('sm');

    const mobileA = (await blockA.boundingBox())!;
    const mobileB = (await blockB.boundingBox())!;
    expect(mobileB.y).toBeGreaterThanOrEqual(mobileA.y + mobileA.height - 4);

    // 切回宽屏（lg: 1440px），校验原双列并排完好无损
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(async () => page.locator('[data-bento-canvas]').getAttribute('data-bento-bp'), {
        timeout: 8_000,
      })
      .toBe('lg');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);

    const restoredA = (await blockA.boundingBox())!;
    const restoredB = (await blockB.boundingBox())!;
    expect(Math.abs(restoredA.y - restoredB.y)).toBeLessThan(16);
    expect(restoredB.x).toBeGreaterThanOrEqual(restoredA.x + restoredA.width - 4);
  });
});
