import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  calculateContrastRatio,
  getRelativeLuminance,
  type RgbColor,
} from '../apps/web-overlay/src/lib/visual-fingerprint';

/**
 * 高对比主流程 E2E（进化轮 2026-11-23 00:22，W6）。
 *
 * 覆盖：首页工具栏「高对比」开关 → <html data-high-contrast="on"> 落下 +
 * aria-pressed 翻转 → 刷新后仍开启（localStorage 保持）→ 关闭恢复普通态；
 * 对比度用 lib/visual-fingerprint 的 calculateContrastRatio 实测（定义在
 * :127；:164 是它在 analyzeVisualFingerprint 内的调用点，不是定义行），
 * 正文与次要文字在浅/深两档下均 ≥ 4.5:1（WCAG AA），不用截图目测。
 *
 * 状态（2026-11-23 00:22，写 spec 时核实；写 spec 过程中并行 lane 落了实现，
 * 00:3x 时 git status 见到未跟踪的新文件，故本段按落地后状态改写）：
 * 实现已落地但未提交：apps/web-overlay/src/lib/high-contrast.ts（W2 新建）、
 * apps/web-overlay/src/components/high-contrast-toggle.tsx（W2 新建）、
 * navigation-toolbar.tsx:497 已挂载（与 FontSizeToggle 并排，工具栏位置符合
 * 任务书）；appearance-guide-dialog.tsx 里另有一份内联同款按钮（同一事件
 * 总线同步）。本 spec 只点工具栏那一份，不开外观弹窗；以后若有开弹窗的
 * 用例，定位器必须按容器收窄——两处按钮的 aria-label 完全相同，strict
 * 模式下会报多命中。
 *
 * grep 核对结果（实现 vs 任务书约定）：存储键 navhub.highContrast.v1 ✓、
 * 事件 navhub:high-contrast-changed + detail { on } ✓、存储值 JSON { on }
 *（旧版裸布尔也认，本文件的 storageIndicatesOn 三种都认）✓、开启落
 * <html data-high-contrast="on">、关闭摘属性 ✓、aria-label 关闭态「高对比」/
 * 开启态「高对比已开启」✓（本文件用 /^高对比/ 前缀定位，两态都命中）、
 * aria-pressed 翻转 ✓。
 * 唯一不一致——关闭态 title：任务书约定为「高对比：加深文字与边框，关闭后
 * 恢复」，实现实际为「高对比：」+ HIGH_CONTRAST_LABEL.hint，即「高对比：
 * 加深文字与边框，弱光下也看得清；与长辈模式可同时开启；首次访问会跟随
 * 系统的"提高对比度"偏好，手动切换后以你的选择为准」。本文件仍按任务书
 * 逐字断言 title（契约测试不断言实现现状、不断言任务书之外的串），所以
 * 在实现方改 title 或任务书改约定之前，关闭态 title 断言会红——这是
 * 待协调员裁决的合同冲突，不是本 spec 的 bug，见轮次笔记 W6 节。
 *
 * 另两处实现细节已进本 spec 的 setup，不再是假设：
 *   - 首访无手动值时 loadHighContrast 会跟随 prefers-contrast: more；
 *     本文件 gotoHome 里用 page.emulateMedia({ contrast: 'no-preference' })
 *     把系统偏好钉死，否则高对比系统偏好开着的机器上「默认普通态」会误红。
 *   - forced-colors 激活时按钮 disabled；同理钉 forcedColors: 'none'。
 *   - 手动标记另有键 navhub.highContrast.manual.v1，干净态要连它一起清。
 *
 * 约定（实现方必须遵守，来源：本轮任务书；组件写法参照 ElderModeToggle）：
 *   - 存储键：localStorage `navhub.highContrast.v1`
 *   - 事件：`navhub:high-contrast-changed`，detail `{ on: boolean }`
 *   - 工具栏按钮：关闭态 title 为「高对比：加深文字与边框，关闭后恢复」，
 *     aria-label 关闭态「高对比」/ 开启态「高对比已开启」（与 ElderModeToggle
 *     同款 on/off 文案模式）；aria-pressed 随状态翻转
 *   - 开启态：<html data-high-contrast="on">；关闭态：属性移除（或 "off"，
 *     本文件按「移除或 off 都算关」断言，不绑死其中一种）
 *   - 刷新后的首屏值由水合前内联脚本先落（与 font-size / elder-mode 同款），
 *     不得等 React 水合才翻，避免闪烁
 *
 * 写法复用（站内既有守卫，不自造新花样）：
 *   - 水合守卫：e2e/half-screen-dock.spec.ts 的 gotoHome——domcontentloaded +
 *     load 宽预算（冷编译）+ #xiaomaomao 已挂载 + 工具栏外观按钮可见 +
 *     入场动画 600ms 落定后再断言/点击
 *   - 水合报错监听：e2e/daypart-hydration.spec.ts——console/pageerror 里出现
 *     hydrat / Minified React error #(418|423|425) 即记一笔，文末断言为空
 *   - 计算样式真断言而非截图：e2e/dark-mode-smoke.spec.ts——暗色用 body 背景
 *     亮度 < 0.5 证明主题真实生效；本文件深色档沿用同一招
 *   - localStorage 预置：dark-mode-smoke.spec.ts——先 goto 一次拿到同源，
 *     再 setItem，最后重新 goto 让首屏读到预置值
 *   - lib 导入：e2e/home-today-zone-u155.spec.ts 已有从
 *     ../apps/web-overlay/src/lib 导入的先例；visual-fingerprint.ts 是
 *     packages/core 的生成镜像（只含纯函数、无 React 导入），spec 侧
 *     导入 calculateContrastRatio / getRelativeLuminance 是安全的
 */

const STORAGE_KEY = 'navhub.highContrast.v1';
/** 手动标记键（lib/high-contrast）：干净态要连它一起清，否则 load 的跟随分支会变 */
const MANUAL_KEY = 'navhub.highContrast.manual.v1';
const CHANGED_EVENT = 'navhub:high-contrast-changed';
/** 关闭态 title 全文（约定值，开启态 title 不作约定、不断言） */
const TITLE_OFF = '高对比：加深文字与边框，关闭后恢复';
/** 工具栏开关：aria-label 关闭态「高对比」/ 开启态「高对比已开启」，前缀锚定两者都命中 */
const HC_BUTTON = 'button';
const CAT = '#xiaomaomao';
const APPEARANCE_BTN = '打开外观排版与新手向导小窗';
/** WCAG AA：正文与次要文字的最低对比度 */
const MIN_RATIO = 4.5;

function hcButton(page: Page): Locator {
  // 不用 title 定位：开启态 title 按 ElderModeToggle 模式会变（on 文案未约定），
  // 只有 aria-label 前缀在两态下都稳定；title 只在关闭态逐字断言。
  return page.getByRole('button', { name: /^高对比/ });
}

async function gotoHome(page: Page, width = 1280, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  // 实现会读系统偏好（prefers-contrast: more 首访自动开；forced-colors
  // 激活时按钮 disabled）：把两处媒体特征钉死，默认态才与机器无关。
  await page.emulateMedia({ contrast: 'no-preference', forcedColors: 'none' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // 首访冷编译预热：宽预算、失败不致命（可能已编译过）
  await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
  await expect(page.locator(CAT)).toBeAttached({ timeout: 60_000 });
  // 首页已加载且工具栏已挂载的证明（half-screen-dock.spec.ts 同款门条件）
  await expect(page.getByRole('button', { name: APPEARANCE_BTN })).toBeVisible({ timeout: 30_000 });
  // 入场动画（xm-enter .32s）落定，避免量到动画中途的几何/样式
  await page.waitForTimeout(600);
}

/** 全新干净态：清掉高对比键（与主题键），重载让首屏按默认态渲染 */
async function gotoHomeClean(page: Page): Promise<void> {
  await gotoHome(page);
  await page.evaluate(
    ([key, manual]) => {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem(manual);
      window.localStorage.removeItem('theme');
    },
    [STORAGE_KEY, MANUAL_KEY] as const,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
  await expect(page.locator(CAT)).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(600);
}

/** 深色档预置（dark-mode-smoke.spec.ts 同款）：先拿同源再写 theme=dark 再重进 */
async function gotoHomeDark(page: Page): Promise<void> {
  await gotoHome(page);
  await page.evaluate(
    ([key, manual]) => {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem(manual);
      window.localStorage.setItem('theme', 'dark');
    },
    [STORAGE_KEY, MANUAL_KEY] as const,
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
  await expect(page.locator(CAT)).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(600);
  // 深色真实生效的证明：body 背景亮度 < 0.5（不是只看 html 有 .dark 类）
  const bg = await readColors(page, page.locator('body'));
  expect(
    getRelativeLuminance(bg.bg),
    `深色档 body 背景亮度应 < 0.5，实测背景 rgb(${bg.bg.r},${bg.bg.g},${bg.bg.b})`,
  ).toBeLessThan(0.5);
}

/** 水合报错收集（daypart-hydration.spec.ts 同款）；文末断言为空 */
function collectHydrationErrors(page: Page): string[] {
  const errors: string[] = [];
  const looksLikeHydration = (text: string) =>
    /hydrat/i.test(text) || /Minified React error #(418|423|425)/.test(text);
  page.on('console', (msg) => {
    const text = msg.text();
    if (looksLikeHydration(text)) errors.push(text);
  });
  page.on('pageerror', (err) => {
    if (looksLikeHydration(err.message)) errors.push(err.message);
  });
  return errors;
}

async function htmlHighContrast(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.documentElement.getAttribute('data-high-contrast'),
  );
}

async function storageIndicatesOn(page: Page): Promise<boolean> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return false;
    if (raw === 'true' || raw === 'on') return true;
    try {
      return (JSON.parse(raw) as { on?: unknown }).on === true;
    } catch {
      return false;
    }
  }, STORAGE_KEY);
}

/** 在点击前装好事件监听，返回之后可读的事件记录（detail 原样存） */
async function armChangedEvents(page: Page): Promise<void> {
  await page.evaluate((eventName) => {
    const store = (window as unknown as { __hcEvents?: Array<{ on?: boolean }> }).__hcEvents ?? [];
    (window as unknown as { __hcEvents?: Array<{ on?: boolean }> }).__hcEvents = store;
    window.addEventListener(eventName, (e: Event) => {
      store.push((e as CustomEvent<{ on?: boolean }>).detail ?? {});
    });
  }, CHANGED_EVENT);
}

async function lastChangedDetail(page: Page): Promise<{ on?: boolean } | undefined> {
  return page.evaluate(() => {
    const store = (window as unknown as { __hcEvents?: Array<{ on?: boolean }> }).__hcEvents ?? [];
    return store[store.length - 1];
  });
}

async function expectHighContrastOn(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-high-contrast') === 'on',
    { timeout: 10_000 },
  );
  await expect(hcButton(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  expect(await storageIndicatesOn(page), `localStorage ${STORAGE_KEY} 应表示开启`).toBe(true);
}

async function expectHighContrastOff(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const v = document.documentElement.getAttribute('data-high-contrast');
      return v === null || v === 'off';
    },
    { timeout: 10_000 },
  );
  await expect(hcButton(page)).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
  await expect(hcButton(page)).toHaveAttribute('title', TITLE_OFF);
  expect(await storageIndicatesOn(page), `localStorage ${STORAGE_KEY} 不应再表示开启`).toBe(false);
}

/** 读某元素的计算文字色与有效背景色（沿祖先上溯到第一个不透明背景） */
async function readColors(page: Page, locator: Locator): Promise<{ fg: RgbColor; bg: RgbColor }> {
  return locator.evaluate((el) => {
    const parse = (css: string): { r: number; g: number; b: number; a: number } => {
      const m = css.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
      if (!m) throw new Error(`解析不出颜色：${css}`);
      return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
    };
    const fg = parse(getComputedStyle(el).color);
    let node: Element | null = el;
    let bg: { r: number; g: number; b: number; a: number } | null = null;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a > 0) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    if (!bg) throw new Error('沿祖先上溯未找到不透明背景色，量不出有效对比度');
    return { fg: { r: fg.r, g: fg.g, b: fg.b }, bg: { r: bg.r, g: bg.g, b: bg.b } };
  });
}

/**
 * 对关键选择器实测对比度（lib 函数在 Node 侧算，颜色在页面侧取）：
 * 正文 = body 默认文字色；标题 = 页面首个可见 h1；次要文字 = main 内首个可见
 * .text-muted-foreground。三者都必须 ≥ 4.5:1。
 *
 * 标题不用 `main#main-content h1`：main 内唯一的 h1 是移动端专用标题
 *（navigation-content.tsx:1207，`md:hidden`，U-263），桌面视口（本 spec
 * 1280×900）下它是 display:none，`.first()` 命中它后 `toBeVisible` 必超时，
 * 致浅色（:273）与深色（:306）两用例双双红——测试选择器问题，不是实现问题。
 * 桌面端的可见 h1 是侧边栏品牌标题（sidebar.tsx:375，`hidden md:block` 的
 * nav 内，main 之外），故用 `h1:visible` 取当前视口下真实可见的主标题。
 */
async function expectKeyContrasts(page: Page, mode: string): Promise<void> {
  const targets: Array<{ label: string; locator: Locator }> = [
    { label: '正文（body）', locator: page.locator('body') },
    { label: '标题（可见 h1）', locator: page.locator('h1:visible').first() },
    {
      label: '次要文字（main 内 .text-muted-foreground）',
      locator: page.locator('main#main-content .text-muted-foreground:visible').first(),
    },
  ];
  for (const { label, locator } of targets) {
    await expect(locator, `${label} 应可见才能量对比度`).toBeVisible({ timeout: 30_000 });
    const { fg, bg } = await readColors(page, locator);
    const ratio = calculateContrastRatio(fg, bg);
    expect(
      ratio,
      `${mode}档 ${label} 对比度应 ≥ ${MIN_RATIO}:1，实测 ${ratio}:1（字 rgb(${fg.r},${fg.g},${fg.b}) / 底 rgb(${bg.r},${bg.g},${bg.b})）`,
    ).toBeGreaterThanOrEqual(MIN_RATIO);
  }
}

test.describe('高对比开关主流程', () => {
  test('浅色：开 → 对比度 ≥4.5 → 刷新仍开 → 关恢复普通态', async ({ page }) => {
    test.setTimeout(180_000);
    const hydrationErrors = collectHydrationErrors(page);
    await gotoHomeClean(page);

    // 默认普通态：属性未落、aria-pressed false、关闭态 title 逐字一致
    expect(await htmlHighContrast(page), '默认不应带 data-high-contrast="on"').not.toBe('on');
    await expect(hcButton(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(hcButton(page)).toHaveAttribute('title', TITLE_OFF);
    expect(await storageIndicatesOn(page), '默认 localStorage 不应表示开启').toBe(false);

    await armChangedEvents(page);
    await hcButton(page).click();
    await expectHighContrastOn(page);
    await expect.poll(() => lastChangedDetail(page), { timeout: 10_000 }).toMatchObject({ on: true });
    await expectKeyContrasts(page, '浅色开启');

    // 刷新后仍开启（localStorage 保持 + 水合前脚本先落值，不闪回普通态）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
    await expect(page.locator(CAT)).toBeAttached({ timeout: 60_000 });
    await page.waitForTimeout(600);
    // 刷新会销毁页面 JS 上下文：armChangedEvents 装的监听与 __hcEvents
    // 一并消失，关闭事件若不重装就录不到（lastChangedDetail 得 undefined，
    // 文末 on:false 断言必超时）。刷新后重装，只录刷新后的事件。
    await armChangedEvents(page);
    await expectHighContrastOn(page);
    await expectKeyContrasts(page, '浅色开启（刷新后）');

    // 关闭 → 恢复普通态（属性摘掉或 off、aria-pressed 翻回、事件 on:false）
    await hcButton(page).click();
    await expectHighContrastOff(page);
    await expect.poll(() => lastChangedDetail(page), { timeout: 10_000 }).toMatchObject({ on: false });

    expect(hydrationErrors, `水合报错应为空：${hydrationErrors.join(' | ')}`).toEqual([]);
  });

  test('深色：开后正文与次要文字对比度仍 ≥4.5，刷新仍开', async ({ page }) => {
    test.setTimeout(180_000);
    const hydrationErrors = collectHydrationErrors(page);
    await gotoHomeDark(page);

    expect(await htmlHighContrast(page), '深色默认不应带 data-high-contrast="on"').not.toBe('on');
    await expect(hcButton(page)).toHaveAttribute('aria-pressed', 'false');

    await armChangedEvents(page);
    await hcButton(page).click();
    await expectHighContrastOn(page);
    await expect.poll(() => lastChangedDetail(page), { timeout: 10_000 }).toMatchObject({ on: true });
    await expectKeyContrasts(page, '深色开启');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load', { timeout: 120_000 }).catch(() => {});
    await expect(page.locator(CAT)).toBeAttached({ timeout: 60_000 });
    await page.waitForTimeout(600);
    await expectHighContrastOn(page);
    await expectKeyContrasts(page, '深色开启（刷新后）');

    await hcButton(page).click();
    await expectHighContrastOff(page);

    expect(hydrationErrors, `水合报错应为空：${hydrationErrors.join(' | ')}`).toEqual([]);
  });

  test('首响 HTML 不含开启态（水合安全：服务端不猜客户端存储）', async ({ request }) => {
    const res = await request.get('/');
    expect(res.ok()).toBe(true);
    const html = await res.text();
    // 只查 <html …> 标签本身：水合前内联脚本源码里可能逐字出现
    // data-high-contrast 字符串，那不算服务端渲染了开启态。
    const htmlTag = html.match(/<html[^>]*>/i)?.[0] ?? '';
    expect(htmlTag, '首响 <html> 标签不应带 data-high-contrast="on"').not.toContain(
      'data-high-contrast="on"',
    );
  });
});
