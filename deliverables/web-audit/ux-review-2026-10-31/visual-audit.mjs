// Phase 1 视觉设计审查 v3：生产实例（.next-audit / :3107），每 URL 独立页面
// 重点页 × 三档视口：mobile-375 / tablet-768 / desktop-1440
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3107';
const OUT = 'deliverables/web-audit/ux-review-2026-10-31';
const SHOTS = path.join(OUT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const SITE_ID = '0035b857-030f-46f9-b074-c0502fbc2497';
const PAGES = [
  { key: 'home', url: '/' },
  { key: 'sites', url: '/sites' },
  { key: 'marketplace', url: '/marketplace' },
  { key: 'site-detail', url: `/site/${SITE_ID}` },
  { key: 'signin', url: '/auth/signin' },
  { key: 'category', url: '/category/ai-tools' },
  { key: 'tags', url: '/tags' },
  { key: 'collections', url: '/collections' },
];
const VIEWPORTS = [
  { key: 'mobile-375', width: 375, height: 812, isMobile: true, hasTouch: true, colorScheme: 'light' },
  { key: 'tablet-768', width: 768, height: 1024, isMobile: false, hasTouch: true, colorScheme: 'light' },
  { key: 'desktop-1440', width: 1440, height: 900, isMobile: false, hasTouch: false, colorScheme: 'light' },
];

const SAMPLER = `(() => {
  const parseRGBA = (s) => {
    const m = s.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
    a: 1,
  });
  const lum = (c) => {
    const f = (u) => { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const effBg = (el) => {
    let stack = [];
    let cur = el;
    while (cur && cur !== document.documentElement.parentNode) {
      const cs = getComputedStyle(cur);
      const bg = parseRGBA(cs.backgroundColor);
      if (bg && bg.a > 0) stack.push(bg);
      if (bg && bg.a >= 0.999) break;
      cur = cur.parentElement;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const results = [];
  const seen = new Set();
  const els = document.querySelectorAll('body *');
  for (const el of els) {
    let text = '';
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
    text = text.trim();
    if (!text) continue;
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const fgRaw = parseRGBA(cs.color);
    if (!fgRaw) continue;
    const bg = effBg(el);
    const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
    const r = ratio(fg, bg);
    const fs = parseFloat(cs.fontSize);
    const fw = parseInt(cs.fontWeight) || 400;
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    const need = large ? 3 : 4.5;
    const desc = (el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0, 3).join('.') : '')).slice(0, 120);
    const key = desc + '|' + cs.color + '|' + fs;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      text: text.slice(0, 40),
      selector: desc,
      color: cs.color,
      bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(',') + ')',
      fontSize: fs,
      fontWeight: fw,
      ratio: Math.round(r * 100) / 100,
      need,
      pass: r >= need,
    });
  }
  return results;
})()`;

const allResults = {};
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
});

async function auditOne(browser, vp, p) {
  const rec = { url: p.url, finalUrl: '', status: null, samples: 0, fails: [], tiny: [], error: null, shot: '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      deviceScaleFactor: 2,
      colorScheme: vp.colorScheme,
    });
    const page = await ctx.newPage();
    try {
      const resp = await page.goto(BASE + p.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      rec.status = resp ? resp.status() : null;
      await page.waitForTimeout(3500);
      rec.finalUrl = page.url();
      const fname = `prod_${vp.key}__${p.key}.png`;
      await page.screenshot({ path: path.join(SHOTS, fname), fullPage: false }).catch(() => {});
      rec.shot = fname;
      const samples = await page.evaluate(SAMPLER);
      rec.samples = samples.length;
      rec.fails = samples.filter((s) => !s.pass).slice(0, 40);
      rec.tiny = samples.filter((s) => s.fontSize < 12).slice(0, 25);
      rec.error = null;
      await ctx.close();
      console.log(`[${vp.key}] ${p.url} status=${rec.status} samples=${rec.samples} fails=${rec.fails.length} tiny=${rec.tiny.length}`);
      return rec;
    } catch (e) {
      rec.error = String(e.message || e).slice(0, 180);
      await ctx.close().catch(() => {});
      if (attempt === 1) console.log(`[${vp.key}] ${p.url} FAIL ${rec.error}`);
    }
  }
  return rec;
}

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    allResults[`${vp.key}|${p.key}`] = await auditOne(browser, vp, p);
  }
}

fs.writeFileSync(path.join(OUT, 'visual-audit-results-prod.json'), JSON.stringify({ base: BASE, allResults }, null, 2));
console.log('DONE -> visual-audit-results-prod.json');
await browser.close();
