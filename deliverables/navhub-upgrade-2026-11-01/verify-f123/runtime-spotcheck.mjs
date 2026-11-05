// 运行时抽查（verify-officer）：对 :3000 运行实例取 getComputedStyle，
// 验证 F1 ring 色 token 与 F3 移动端 16px 表单字号真的落地到渲染层。
// 用法: node runtime-spotcheck.mjs
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';

const req = createRequire(import.meta.url);
// pnpm 布局下 playwright 藏在 .pnpm 里
let pw;
try {
  pw = req('playwright');
} catch {
  const base = 'C:/Users/许进龙/Desktop/web/node_modules/.pnpm';
  const hit = readdirSync(base).find((d) => d.startsWith('playwright@'));
  pw = req(`${base}/${hit}/node_modules/playwright`);
}

let browser;
for (const channel of ['msedge', 'chrome', undefined]) {
  try {
    browser = await pw.chromium.launch(channel ? { channel } : {});
    console.log('# launched via', channel ?? 'bundled');
    break;
  } catch (e) {
    console.log('# launch failed via', channel ?? 'bundled', '-', String(e).split('\n')[0]);
  }
}
if (!browser) throw new Error('no usable browser');
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // 移动视口触发 767px 规则
await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2000);

const result = await page.evaluate(() => {
  const out = {};
  const rootStyle = getComputedStyle(document.documentElement);
  out.ringToken = rootStyle.getPropertyValue('--ring').trim();
  out.backgroundToken = rootStyle.getPropertyValue('--background').trim();
  out.destructiveTextToken = rootStyle.getPropertyValue('--destructive-text').trim();
  out.mutedFgToken = rootStyle.getPropertyValue('--muted-foreground').trim();
  out.borderStrongToken = rootStyle.getPropertyValue('--border-strong').trim();

  // 实际渲染元素
  // 所有 input/textarea/select 的边框实况
  out.controls = [];
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const s = getComputedStyle(el);
    out.controls.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      fontSize: s.fontSize,
      borderWidth: s.borderTopWidth,
      borderColor: s.borderTopColor,
      cls: (el.className || '').toString(),
    });
  }
  // 焦点环类元素（有 ring 类的按钮/链接）
  const ringEl = document.querySelector('.ring, .focus-visible\\:ring, [class*="ring"]');
  if (ringEl) {
    const s = getComputedStyle(ringEl);
    out.ringElOutline = s.outlineColor + ' / ' + s.outlineWidth;
    out.ringElClasses = (ringEl.className || '').toString().slice(0, 120);
  } else {
    out.ringElOutline = 'NO-RING-EL';
  }
  out.htmlClass = document.documentElement.className;
  out.accentAttr = document.documentElement.getAttribute('data-accent');
  return out;
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
